// IPC channels for e-documents, invoice printing and sharing, print templates, cheque printing. Registered
// from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed
// here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) —
// the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { BrowserWindow, dialog, ShareMenu, shell } from 'electron'
import { readFileSync } from 'fs'
import { decodeTextFile } from '@shared/textFiles'
import { z } from 'zod'
import { chequeConfigSchema, isoDate, periodSchema, voucherTransportSchema } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import { AppError } from '@shared/errors'
import * as configSvc from './services/config'
import * as edocs from './services/edocs'
import * as invoice from './services/invoice'
import * as billShare from './services/billShare'
import * as upiSettings from './services/upiSettings'
import { SHARE_VIAS } from '@shared/billShare'
import * as printTemplates from './services/printTemplates'
import * as cheque from './services/cheque'
import { invoicePdfBatchSchema } from '@shared/schemas'
import { invoiceConfigPartialSchema } from '@shared/invoiceConfig'
import { printDocKindSchema, printTemplateSchema } from '@shared/printTemplates'
import { auditExport, pickExportPath, type IpcContext, type IpcHandle } from './ipcCommon'
import { gstPeriodInput } from './ipcGst'

export function registerPrintingIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- e-documents + invoice printing ----------
  handle('edoc:list', (p) => {
    const { from, to } = periodSchema.parse(p)
    const c = requireCompany()
    return edocs.listSalesInvoices(c.db, from, to, c.info)
  }, 'viewer')
  handle('edoc:exportEInvoice', async (p) => {
    // to-do §4: an optional range inside the period (absent = the whole period, as before).
    const { from, to, period, range } = gstPeriodInput
      .extend({ range: z.object({ from: isoDate, to: isoDate }).optional() })
      .refine((q) => !q.range || (q.range.from <= q.range.to && q.range.from >= q.from && q.range.to <= q.to), {
        message: 'The dates must lie within the period, the first on or before the last',
        path: ['range']
      })
      .parse(p)
    const c = requireCompany()
    const target = await pickExportPath(c.slug, { defaultName: edocs.eInvoiceFileName(period, range), title: 'Save e-invoice JSON', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!target) return { path: '', count: 0, cancelled: true }
    const r = edocs.exportEInvoices(c.db, c.info, c.slug, from, to, period, { path: target, range })
    auditExport(c.db, 'einvoice', { period, ...(range ? { range } : {}), path: r.path, count: r.count })
    shell.showItemInFolder(r.path)
    return r
  })
  handle('edoc:exportEwb', (p) => {
    const { from, to, period, voucherIds, includeBelowThreshold } = gstPeriodInput
      .extend({
        voucherIds: z.array(z.number().int().positive()).max(500).optional(),
        includeBelowThreshold: z.boolean().default(false)
      })
      .parse(p)
    const c = requireCompany()
    // Writes the combined bulk file AND one single-bill file per voucher (exports/ewb/<period>/).
    const r = edocs.exportEwb(c.db, c.info, c.slug, from, to, period, { voucherIds, includeBelowThreshold })
    auditExport(c.db, 'ewb', { period, path: r.path, count: r.count })
    shell.showItemInFolder(r.path)
    return r
  })
  handle('edoc:ewbJson', (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const r = edocs.ewbJsonForVoucher(c.db, c.info, c.slug, voucherId)
    auditExport(c.db, 'ewb_json', { voucherId, path: r.path })
    shell.showItemInFolder(r.path)
    return r
  })
  handle('edoc:transportGet', (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    return edocs.getTransport(requireCompany().db, voucherId)
  }, 'viewer')
  handle('edoc:transportSet', (p) => {
    const { voucherId, data } = z
      .object({ voucherId: z.number().int().positive(), data: voucherTransportSchema })
      .parse(p)
    return edocs.setTransport(requireCompany().db, voucherId, data)
  })
  handle('invoice:pdf', async (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const path = await invoice.invoicePdf(c.db, c.info, c.slug, voucherId)
    auditExport(c.db, 'invoice_pdf', { voucherId, path })
    void shell.openPath(path)
    return { path }
  })
  // ---------- batch invoice printing (lane Q, task Q2 #98) ----------
  handle('invoice:pdfBatch', async (p) => {
    const { voucherIds } = invoicePdfBatchSchema.parse(p)
    const c = requireCompany()
    const r = await invoice.invoicePdfBatch(c.db, c.info, c.slug, voucherIds)
    auditExport(c.db, 'invoice_pdf_batch', { count: r.paths.length, dir: r.dir })
    shell.showItemInFolder(r.paths[0] ?? r.dir)
    return r
  })

  // ---------- A10: share a bill, the UPI ID on prints ----------
  handle('invoice:shareFacts', (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).strict().parse(p)
    const c = requireCompany()
    return billShare.billShareFacts(c.db, c.info, voucherId, todayISO())
  }, 'viewer')
  // The PDF is written to the exports folder (as invoice:pdf) and shown in Finder — or handed to
  // the macOS share sheet with the message. WhatsApp / e-mail are links the RENDERER opens
  // (wa.me / mailto:, allowed by shared/externalLinks.ts); the app itself sends nothing.
  handle('invoice:share', async (p) => {
    const { voucherId, via, text } = z
      .object({ voucherId: z.number().int().positive(), via: z.enum(SHARE_VIAS), text: z.string().max(2000).optional() })
      .strict()
      .parse(p)
    const c = requireCompany()
    const facts = billShare.billShareFacts(c.db, c.info, voucherId, todayISO())
    if (!facts.shareable) throw new AppError('share_not_bill', 'Only a sales bill or a credit note can be shared')
    const path = await invoice.invoicePdf(c.db, c.info, c.slug, voucherId)
    auditExport(c.db, 'invoice_share', { voucherId, path, via })
    let sheet = false
    if (via === 'sheet' && process.platform === 'darwin') {
      const win = BrowserWindow.getFocusedWindow?.() ?? BrowserWindow.getAllWindows?.()[0]
      new ShareMenu({ filePaths: [path], ...(text ? { texts: [text] } : {}) }).popup(win ? { window: win } : {})
      sheet = true
    } else {
      shell.showItemInFolder(path)
    }
    return { path, sheet }
  })
  handle('upi:get', () => upiSettings.getUpiSettings(requireCompany().db), 'viewer')
  handle('upi:set', (p) => upiSettings.setUpiSettings(requireCompany().db, z.object({ upiId: z.string().max(320).nullable() }).strict().parse(p)), 'owner')

  handle('invoice:previewHtml', (p) => {
    const { voucherId, config } = z
      .object({ voucherId: z.number().int().positive().optional(), config: invoiceConfigPartialSchema.optional() })
      .prefault({})
      .parse(p ?? {})
    const c = requireCompany()
    return invoice.invoicePreviewHtml(c.db, c.info, voucherId, config)
  }, 'viewer')

  // ---------- print templates (WP 1.10c) ----------
  // Read/preview: viewer+. Edit (save/duplicate/delete/reset/defaults/import): accountant+.
  const templateIdSchema = z.object({ id: z.string().min(1).max(60) })
  handle('template:list', () => printTemplates.listTemplates(requireCompany().db), 'viewer')
  handle('template:get', (p) => printTemplates.getTemplate(requireCompany().db, templateIdSchema.parse(p).id), 'viewer')
  handle('template:save', (p) => {
    const { template } = z.object({ template: printTemplateSchema }).parse(p)
    return printTemplates.saveTemplate(requireCompany().db, template)
  })
  handle('template:duplicate', (p) => printTemplates.duplicateTemplate(requireCompany().db, templateIdSchema.parse(p).id))
  handle('template:delete', (p) => {
    printTemplates.deleteTemplate(requireCompany().db, templateIdSchema.parse(p).id)
    return { ok: true }
  })
  handle('template:reset', (p) => printTemplates.resetTemplate(requireCompany().db, templateIdSchema.parse(p).id))
  handle('template:setDefault', (p) => {
    const { kind, id } = z.object({ kind: printDocKindSchema, id: z.string().min(1).max(60) }).parse(p)
    return printTemplates.setDefaultTemplate(requireCompany().db, kind, id)
  })
  handle('template:previewHtml', (p) => {
    const { template, voucherId, kind } = z
      .object({ template: printTemplateSchema, voucherId: z.number().int().positive().optional(), kind: printDocKindSchema.optional() })
      .parse(p)
    const c = requireCompany()
    return printTemplates.templatePreviewHtml(c.db, c.info, template, { voucherId, kind })
  }, 'viewer')
  handle('template:testPdf', async (p) => {
    const { template, kind } = z.object({ template: printTemplateSchema, kind: printDocKindSchema.optional() }).parse(p)
    const c = requireCompany()
    const path = await printTemplates.templateTestPdf(c.db, c.info, c.slug, template, kind)
    auditExport(c.db, 'print_test_pdf', { templateId: template.id, path })
    void shell.openPath(path)
    return { path }
  })
  handle('template:export', (p) => {
    const { id } = templateIdSchema.parse(p)
    const c = requireCompany()
    const path = printTemplates.exportTemplate(c.db, c.slug, id)
    auditExport(c.db, 'print_template', { templateId: id, path })
    shell.showItemInFolder(path)
    return { path }
  }, 'viewer')
  // `jsonText` inline lets drivers/tests import without the native file dialog.
  handle('template:import', async (p) => {
    const { jsonText } = z.object({ jsonText: z.string().max(2_000_000).optional() }).prefault({}).parse(p ?? {})
    let text = jsonText
    if (text === undefined) {
      const picked = await dialog.showOpenDialog({
        title: 'Choose a Total print template (.json)',
        filters: [{ name: 'Print template', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      text = decodeTextFile(readFileSync(picked.filePaths[0]))
    }
    return printTemplates.importTemplate(requireCompany().db, text)
  })

  // ---------- cheque printing + payment advice (task 2.7) ----------
  const bankLedgerIdSchema = z.object({ bankLedgerId: z.number().int().positive() })
  handle('cheque:config:get', (p) => configSvc.getChequeConfig(requireCompany().db, bankLedgerIdSchema.parse(p).bankLedgerId), 'viewer')
  handle('cheque:config:set', (p) => {
    const { bankLedgerId, config } = z.object({ bankLedgerId: z.number().int().positive(), config: chequeConfigSchema }).parse(p)
    return configSvc.setChequeConfig(requireCompany().db, bankLedgerId, config)
  })
  handle('cheque:pdf', async (p) => {
    const { voucherId, bankLedgerId } = z
      .object({ voucherId: z.number().int().positive(), bankLedgerId: z.number().int().positive() })
      .parse(p)
    const c = requireCompany()
    // chequePdf itself reveals the file in Finder — a cheque is meant to be loaded into the
    // printer tray and checked for alignment, not opened in a PDF viewer.
    const path = await cheque.chequePdf(c.db, c.info, c.slug, voucherId, bankLedgerId)
    auditExport(c.db, 'cheque_pdf', { voucherId, bankLedgerId, path })
    return { path }
  })
  handle('cheque:testGrid', async (p) => {
    const { bankLedgerId } = bankLedgerIdSchema.parse(p)
    const c = requireCompany()
    const path = await cheque.testGridPdf(c.db, c.info, c.slug, bankLedgerId)
    auditExport(c.db, 'cheque_test_grid', { bankLedgerId, path })
    void shell.openPath(path)
    return { path }
  })
  handle('cheque:advice', async (p) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).parse(p)
    const c = requireCompany()
    const path = await cheque.paymentAdvicePdf(c.db, c.info, c.slug, voucherId)
    auditExport(c.db, 'payment_advice', { voucherId, path })
    void shell.openPath(path)
    return { path }
  })
}
