// IPC channels for GST returns, validation panel + 3B adjustments, GST expansion (2B, IMS, GSTR-9, ITC-04,
// RCM, ITC reversal). Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope);
// every payload is Zod-parsed here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts
// by audit A12 (HEALTH-4) — the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares
// them with origin/main).
import { dialog, shell } from 'electron'
import { readFileSync } from 'fs'
import { basename } from 'path'
import { decodeTextFile } from '@shared/textFiles'
import { z } from 'zod'
import { gst3bManualSchema, gstr2bSchema, periodSchema } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import { AppError } from '@shared/errors'
import * as configSvc from './services/config'
import * as dashboard from './services/dashboard'
import * as gst from './services/gst'
import * as gstAnnual from './services/gstAnnual'
import * as gstIms from './services/gstIms'
import * as gstRcm from './services/gstRcm'
import * as gstItcRev from './services/gstItcReversal'
import {
  fyStartSchema, imsSetSchema, itc04QuerySchema, itcReversalInputsSchema, itcReversalQuerySchema, recon2bTolerancesSchema,
  selfInvoiceGenerateSchema, selfInvoiceSeriesSchema
} from '@shared/gst/expansionSchemas'
import { recon2bOptionsFrom } from '@shared/gst/recon2b'
import * as edocs from './services/edocs'
import * as simpleTaxes from './services/simpleTaxes'
import { gstStartsOn, quarterExportMonths } from '@shared/simple/taxes'
import { auditExport, type IpcContext, type IpcHandle, type OpenCompany } from './ipcCommon'

/** A GST return's period (also the e-invoice / e-way exports, ipcPrinting.ts). */
export const gstPeriodInput = periodSchema.extend({ period: z.string().regex(/^\d{6}$/) })

export function registerGstIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- gst ----------
  handle('gst:gstr1', (p) => {
    const { from, to, period } = gstPeriodInput.parse(p)
    const c = requireCompany()
    return gst.gstr1(c.db, c.info, from, to, period)
  }, 'viewer')
  // Audit A8 / UX-4: the return period the GST screens open on — dashGst's (the Compliance card's,
  // the simple Taxes default), from the day GST starts in these books. Null unless regular.
  handle('gst:duePeriod', () => {
    const c = requireCompany()
    return dashboard.gstDuePeriod(c.db, c.info, todayISO(), gstStartsOn(c.info.booksBeginDate, c.info.gstRegistrationSince))
  }, 'viewer')
  handle('gst:gstr3b', (p) => {
    const { from, to, period } = gstPeriodInput.parse(p)
    const c = requireCompany()
    return gst.gstr3b(c.db, c.info, from, to, period)
  }, 'viewer')
  // One month's GSTR-1 export (the full app's month-by-month export, unchanged): the JSON, the
  // summary CSV, the GSTR-9 "as filed" snapshot and one export audit row.
  const exportGstr1Month = (c: OpenCompany, from: string, to: string, period: string): { jsonPath: string; csvPath: string } => {
    const result = gst.gstr1(c.db, c.info, from, to, period)
    const jsonPath = gst.exportReturnJson(c.slug, 'gstr1', period, result.json)
    const csvPath = gst.exportGstr1Csv(c.slug, result)
    // WP 3.4: what was exported is the "as filed" side of the GSTR-9 comparison.
    gstAnnual.recordGstr1Export(c.db, period, result.json)
    auditExport(c.db, 'gstr1', { period, path: jsonPath })
    return { jsonPath, csvPath }
  }
  const exportGstr3bMonth = (c: OpenCompany, from: string, to: string, period: string): { jsonPath: string } => {
    const result = gst.gstr3b(c.db, c.info, from, to, period)
    const jsonPath = gst.exportReturnJson(c.slug, 'gstr3b', period, result.json)
    gstAnnual.recordGstr3bExport(c.db, period, result)
    auditExport(c.db, 'gstr3b', { period, path: jsonPath })
    return { jsonPath }
  }
  // A quarterly filer's export (`quarter: true`, from / to = the whole quarter, period = its last
  // month): the three monthly exports above, exactly as the full app writes them (every month's
  // gate checked before anything is written), then copied into one folder.
  const exportGstQuarter = (c: OpenCompany, form: 'gstr1' | 'gstr3b', from: string, to: string, period: string): { folder: string; files: string[] } => {
    const months = quarterExportMonths(from, to, period)
    if (!months) throw new AppError('invalid_input', 'A quarterly export covers a whole quarter, named by its last month.', { field: 'period' })
    for (const m of months) gst.assertExportable(c.db, c.info, m.from, m.to)
    // One transaction: a failure on a later month (or while copying) leaves no month's GSTR-9
    // snapshot or audit row behind, so the quarter is never half "prepared". Files already written
    // are the monthly exports' own (a re-export rewrites them).
    const bundle = c.db.transaction(() => {
      const files = months.flatMap((m) => {
        if (form === 'gstr3b') return [exportGstr3bMonth(c, m.from, m.to, m.period).jsonPath]
        const r = exportGstr1Month(c, m.from, m.to, m.period)
        return [r.jsonPath, r.csvPath]
      })
      return simpleTaxes.bundleQuarterFiles(c.slug, form, period, files)
    })()
    shell.showItemInFolder(bundle.files[0] ?? bundle.folder)
    return bundle
  }
  const gstExportInput = gstPeriodInput.extend({ quarter: z.literal(true).optional() })
  handle('gst:exportGstr1', (p) => {
    const { from, to, period, quarter } = gstExportInput.parse(p)
    const c = requireCompany()
    if (quarter) return exportGstQuarter(c, 'gstr1', from, to, period)
    // Server-side export gate (G7): blocking validation issues refuse the export outright —
    // the renderer disables the button too, but the gate must hold for any caller.
    gst.assertExportable(c.db, c.info, from, to)
    const { jsonPath, csvPath } = exportGstr1Month(c, from, to, period)
    shell.showItemInFolder(jsonPath)
    return { jsonPath, csvPath }
  })
  // ---------- gst rebuild (lane G): validation panel + 3B manual adjustments ----------
  handle('gst:validate', (p) => {
    const { from, to } = periodSchema.parse(p)
    const c = requireCompany()
    const issues = gst.gstValidate(c.db, c.info, from, to)
    const roundOff = edocs.einvoiceRoundOffIssues(c.db, c.info, from, to)
    return { issues, roundOff }
  }, 'viewer')
  // Trade cycle (WP 2.5b): the invoice editor warns about a sales number the IRP would refuse
  // (NIC DocDtls.No) only while the company e-invoices.
  handle('gst:einvoicing', () => {
    const c = requireCompany()
    return gst.getEinvoicing(c.db, c.info)
  }, 'viewer')
  // To-do §4: what the business profile (gstProfile turnover / exemption) says about e-invoicing
  // today, the switch, the "turn it on" notice and the IRP 30-day window. Read-only.
  handle('gst:einvoiceStatus', () => {
    const c = requireCompany()
    return gst.einvoiceStatus(c.db, c.info, todayISO())
  }, 'viewer')
  // Review follow-up: the explicit e-invoicing switch (meta `einvoicing`), owner-only, audited.
  handle('einvoicing:set', (p) => {
    const input = z.object({ enabled: z.boolean() }).strict().parse(p)
    const c = requireCompany()
    return gst.setEinvoicing(c.db, c.info, input)
  }, 'owner')
  handle('gst:3bManualGet', (p) => {
    const { period } = z.object({ period: z.string().regex(/^\d{6}$/) }).parse(p)
    return configSvc.getGst3bManual(requireCompany().db, period)
  }, 'viewer')
  handle('gst:3bManualSet', (p) => {
    const { period, data } = z.object({ period: z.string().regex(/^\d{6}$/), data: gst3bManualSchema }).parse(p)
    return configSvc.setGst3bManual(requireCompany().db, period, data)
  })
  handle('gst:exportGstr3b', (p) => {
    const { from, to, period, quarter } = gstExportInput.parse(p)
    const c = requireCompany()
    if (quarter) return exportGstQuarter(c, 'gstr3b', from, to, period)
    // Same server-side gate as gst:exportGstr1 — 3B is computed from the same extracted
    // documents, so a period with blocking validation issues must not export either return.
    gst.assertExportable(c.db, c.info, from, to)
    const { jsonPath } = exportGstr3bMonth(c, from, to, period)
    shell.showItemInFolder(jsonPath)
    return { jsonPath }
  })
  handle('gst:recon2b', (p) => {
    const { jsonText, from, to } = gstr2bSchema.parse(p)
    const db = requireCompany().db
    return gst.recon2b(db, jsonText, from, to, recon2bOptionsFrom(gstIms.getRecon2bTolerances(db)))
  }, 'viewer')

  // ---------- GST expansion (WP 3.4): 2B tolerances + IMS, GSTR-9, ITC-04, RCM self-invoices, ITC reversal ----------
  handle('gst:recon2bTolerancesGet', () => gstIms.getRecon2bTolerances(requireCompany().db), 'viewer')
  handle('gst:recon2bTolerancesSet', (p) => gstIms.setRecon2bTolerances(requireCompany().db, recon2bTolerancesSchema.parse(p)))
  handle('gst:imsList', (p) => {
    const { period } = z.object({ period: z.string().regex(/^\d{6}$/) }).parse(p)
    return gstIms.listImsActions(requireCompany().db, period)
  }, 'viewer')
  handle('gst:imsSet', (p) => {
    const { period, decisions } = imsSetSchema.parse(p)
    return gstIms.setImsActions(requireCompany().db, period, decisions)
  })
  handle('gst:imsExport', (p) => {
    const { period } = z.object({ period: z.string().regex(/^\d{6}$/) }).parse(p)
    const c = requireCompany()
    const r = gstIms.exportImsActions(c.db, c.slug, c.info.gstin ?? '', period)
    auditExport(c.db, 'ims_actions', { period, path: r.jsonPath, count: r.count })
    shell.showItemInFolder(r.jsonPath)
    return r
  }, 'viewer')
  handle('gst:gstr9', (p) => {
    const { fyStartYear } = fyStartSchema.parse(p)
    const c = requireCompany()
    return gstAnnual.gstr9(c.db, c.info, fyStartYear)
  }, 'viewer')
  handle('gst:exportGstr9', (p) => {
    const { fyStartYear } = fyStartSchema.parse(p)
    const c = requireCompany()
    const r = gstAnnual.exportGstr9(c.db, c.info, c.slug, fyStartYear)
    auditExport(c.db, 'gstr9', { fyStartYear, path: r.jsonPath })
    shell.showItemInFolder(r.jsonPath)
    return r
  }, 'viewer')
  handle('gst:itc04', (p) => {
    const q = itc04QuerySchema.parse(p)
    const c = requireCompany()
    return gstAnnual.itc04(c.db, c.info, q)
  }, 'viewer')
  handle('gst:exportItc04', (p) => {
    const q = itc04QuerySchema.parse(p)
    const c = requireCompany()
    const r = gstAnnual.exportItc04(c.db, c.info, c.slug, q)
    auditExport(c.db, 'itc04', { ...q, path: r.jsonPath })
    shell.showItemInFolder(r.jsonPath)
    return r
  }, 'viewer')
  handle('gst:selfInvoices', (p) => {
    const { from, to } = periodSchema.parse(p)
    const c = requireCompany()
    return gstRcm.listSelfInvoices(c.db, c.info, from, to, todayISO())
  }, 'viewer')
  handle('gst:selfInvoiceGenerate', (p) => {
    const { voucherId, date } = selfInvoiceGenerateSchema.parse(p)
    return gstRcm.generateSelfInvoice(requireCompany().db, voucherId, date)
  })
  handle('gst:selfInvoicePdf', async (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const path = await gstRcm.selfInvoicePdf(c.db, c.info, c.slug, voucherId)
    auditExport(c.db, 'self_invoice_pdf', { voucherId, path })
    shell.openPath(path)
    return { path }
  }, 'viewer')
  handle('gst:selfInvoiceSeriesGet', () => gstRcm.getSelfInvoiceSeries(requireCompany().db), 'viewer')
  handle('gst:selfInvoiceSeriesSet', (p) => gstRcm.setSelfInvoiceSeries(requireCompany().db, selfInvoiceSeriesSchema.parse(p)))
  handle('gst:itcReversal', (p) => {
    const { from, to, period, inputs } = itcReversalQuerySchema.parse(p)
    const c = requireCompany()
    return gstItcRev.itcReversal(c.db, c.info, from, to, period, inputs)
  }, 'viewer')
  handle('gst:itcReversalInputsSet', (p) => {
    const { period, inputs } = z.object({ period: z.string().regex(/^\d{6}$/), inputs: itcReversalInputsSchema }).parse(p)
    return gstItcRev.setItcReversalInputs(requireCompany().db, period, inputs)
  })
  handle('gst:itcReversalApply', (p) => {
    const { from, to, period } = itcReversalQuerySchema.parse(p)
    const c = requireCompany()
    return gstItcRev.applyItcReversalTo3b(c.db, c.info, from, to, period)
  })
  handle('gst:itcReversalPost', (p) => {
    const { from, to, period } = itcReversalQuerySchema.parse(p)
    const c = requireCompany()
    return gstItcRev.postItcReversal(c.db, c.info, from, to, period)
  })
  handle('gst:recon2bPickFile', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose a GSTR-2B JSON (downloaded from the GST portal)',
      filters: [{ name: 'GSTR-2B JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const jsonText = decodeTextFile(readFileSync(picked.filePaths[0]))
    return { jsonText, fileName: basename(picked.filePaths[0]) || 'gstr2b.json' }
  }, 'viewer')
}
