// IPC channels for trade cycle: kinds, numbering, quotations / orders, links, reports, returns, closure.
// Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is
// Zod-parsed here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12
// (HEALTH-4) — the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with
// origin/main).
import { shell } from 'electron'
import { z } from 'zod'
import { godownInputSchema, stockGroupInputSchema, stockItemInputSchema, unitInputSchema } from '@shared/schemas'
import * as masters from './services/masters'
import * as printTemplates from './services/printTemplates'
import * as tradeLinks from './services/tradeLinks'
import * as tradeDocTypes from './services/tradeDocTypes'
import * as tradeReports from './services/tradeReports'
import * as tradeLists from './services/tradeLists'
import * as tradeDocs from './services/tradeDocs'
import * as tradeChain from './services/tradeChain'
import * as tradeAnalysis from './services/tradeAnalysis'
import * as tradeClosure from './services/tradeClosure'
import { quickCreateItem } from './services/quickCreate'
import { quickItemSchema } from '@shared/schemas'
import { settleDraftOnSave } from './ai/drafts'
import {
  linksForVoucherSchema, openSourceLinesSchema, tradePendingSchema, tradeNoteListSchema, tradeDocNextNumberSchema,
  tradeDocTypeSaveSchema, tradeDocListSchema, tradeDocSaveSchema, tradeDocActionSchema, tradeDocConvertSchema,
  pendingOrdersSchema, quotationPipelineSchema, openOrderValueSchema, tradeChainSchema, threeWayMatchSchema, itemDemandSchema,
  orderBookSchema, leadTimeSchema, returnsRegisterSchema, returnsRateSchema, asOnSchema, staleDocumentsSchema, noteActionSchema,
  noteClosureSchema, closeStaleQuotationsSchema
} from '@shared/schemas'
import { auditExport, idSchema, withIdSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerTradeIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- trade cycle (WP 2.5a): kinds, order / quotation numbering series, line links ----------
  handle('voucherKinds:list', () => tradeDocTypes.listVoucherKinds(requireCompany().db), 'viewer')
  handle('tradeDocTypes:list', () => tradeDocTypes.listTradeDocTypes(requireCompany().db), 'viewer')
  handle('tradeDocTypes:save', (p) => {
    const { id, data } = tradeDocTypeSaveSchema.parse(p)
    return tradeDocTypes.saveTradeDocType(requireCompany().db, data, id)
  })
  handle('tradeDocs:nextNumber', (p) => {
    const { docTypeId, date } = tradeDocNextNumberSchema.parse(p)
    return tradeDocTypes.nextTradeDocNumber(requireCompany().db, docTypeId, date)
  }, 'viewer')
  handle('links:forVoucher', (p) => tradeLinks.linksForVoucher(requireCompany().db, linksForVoucherSchema.parse(p).voucherId), 'viewer')
  handle('links:openSourceLines', (p) => tradeLinks.openSourceLines(requireCompany().db, openSourceLinesSchema.parse(p)), 'viewer')
  handle('trade:pending', (p) => {
    const { stage, asOn } = tradePendingSchema.parse(p)
    return tradeReports.pendingStockNotes(requireCompany().db, stage, asOn)
  }, 'viewer')
  // WP 2.5b lists: the challan / GRN list screens (documents + live links at query time).
  handle('trade:noteList', (p) => tradeLists.listStockNotes(requireCompany().db, tradeNoteListSchema.parse(p)), 'viewer')
  // ---------- quotations / sales orders / purchase orders (WP 2.5c) ----------
  handle('tradeDocs:list', (p) => tradeDocs.listTradeDocs(requireCompany().db, tradeDocListSchema.parse(p)), 'viewer')
  handle('tradeDocs:get', (p) => tradeDocs.getTradeDoc(requireCompany().db, idSchema.parse(p).id), 'viewer')
  handle('tradeDocs:save', (p) => {
    const { data, id, aiDraftId } = tradeDocSaveSchema.extend({ aiDraftId: z.number().int().positive().optional() }).parse(p)
    const db = requireCompany().db
    // WP 5.3: a document reviewed from an AI draft saves through the normal path; the draft is
    // settled in the same transaction.
    if (!aiDraftId || id) return tradeDocs.saveTradeDoc(db, data, id)
    return db.transaction(() => {
      const saved = tradeDocs.saveTradeDoc(db, data)
      settleDraftOnSave(db, aiDraftId, { tradeDocId: saved.doc.id }, 'tradeDoc')
      return saved
    })()
  })
  handle('tradeDocs:delete', (p) => tradeDocs.deleteTradeDoc(requireCompany().db, tradeDocActionSchema.parse(p).id))
  handle('tradeDocs:restore', (p) => tradeDocs.restoreTradeDoc(requireCompany().db, tradeDocActionSchema.parse(p).id))
  handle('tradeDocs:cancel', (p) => {
    const { id, reason } = tradeDocActionSchema.parse(p)
    return tradeDocs.cancelTradeDoc(requireCompany().db, id, reason)
  })
  handle('tradeDocs:close', (p) => {
    const { id, reason } = tradeDocActionSchema.parse(p)
    return tradeDocs.closeTradeDoc(requireCompany().db, id, reason)
  })
  handle('tradeDocs:reopen', (p) => {
    const { id, reason } = tradeDocActionSchema.parse(p)
    return tradeDocs.reopenTradeDoc(requireCompany().db, id, reason)
  })
  handle('tradeDocs:convert', (p) => {
    const { id, to } = tradeDocConvertSchema.parse(p)
    return tradeDocs.convertTradeDoc(requireCompany().db, id, to)
  })
  handle('tradeDocs:duplicate', (p) => tradeDocs.duplicateTradeDoc(requireCompany().db, idSchema.parse(p).id))
  handle('tradeDocs:pdf', async (p) => {
    const { id } = idSchema.parse(p)
    const c = requireCompany()
    const path = await printTemplates.tradeDocPdf(c.db, c.info, c.slug, id)
    auditExport(c.db, 'trade_doc_pdf', { tradeDocId: id, path })
    void shell.openPath(path)
    return { path }
  })
  handle('tradeDocs:previewHtml', (p) => {
    const { id } = idSchema.parse(p)
    const c = requireCompany()
    return { html: printTemplates.tradeDocHtml(c.db, c.info, id).html }
  }, 'viewer')
  handle('trade:pendingOrders', (p) => {
    const { kind, asOn } = pendingOrdersSchema.parse(p)
    return tradeReports.pendingOrders(requireCompany().db, kind, asOn)
  }, 'viewer')
  handle('trade:quotationPipeline', (p) => {
    const { from, to, asOn } = quotationPipelineSchema.parse(p)
    return tradeReports.quotationPipeline(requireCompany().db, from, to, asOn)
  }, 'viewer')
  handle('trade:openSalesOrderValue', (p) => tradeDocs.openSalesOrderValue(requireCompany().db, openOrderValueSchema.parse(p).partyLedgerId), 'viewer')

  // ---------- trade cycle (WP 2.5d): linked documents, reports, returns, closure ----------
  handle('trade:chain', (p) => tradeChain.tradeChain(requireCompany().db, tradeChainSchema.parse(p)), 'viewer')
  handle('trade:threeWayMatch', (p) => {
    const { from, to, ...tolerances } = threeWayMatchSchema.parse(p)
    return tradeAnalysis.threeWayMatchReport(requireCompany().db, { from, to, tolerances })
  }, 'viewer')
  handle('trade:itemDemand', (p) => {
    const { asOn, onlyOpen } = itemDemandSchema.parse(p)
    return tradeAnalysis.itemDemand(requireCompany().db, asOn, { onlyOpen })
  }, 'viewer')
  handle('trade:orderBook', (p) => tradeAnalysis.orderBook(requireCompany().db, orderBookSchema.parse(p)), 'viewer')
  handle('trade:leadTime', (p) => tradeAnalysis.leadTime(requireCompany().db, leadTimeSchema.parse(p)), 'viewer')
  handle('trade:returnsRegister', (p) => tradeAnalysis.returnsRegister(requireCompany().db, returnsRegisterSchema.parse(p)), 'viewer')
  handle('trade:returnsRate', (p) => tradeAnalysis.returnsRate(requireCompany().db, returnsRateSchema.parse(p)), 'viewer')
  handle('trade:unbilledGoods', (p) => tradeAnalysis.unbilledGoods(requireCompany().db, asOnSchema.parse(p).asOn), 'viewer')
  handle('trade:staleDocuments', (p) => {
    const { asOn, ...opts } = staleDocumentsSchema.parse(p)
    return tradeAnalysis.staleDocuments(requireCompany().db, asOn, opts)
  }, 'viewer')
  handle('trade:noteClosure', (p) => tradeClosure.noteClosure(requireCompany().db, noteClosureSchema.parse(p).voucherId), 'viewer')
  handle('trade:closeVoucher', (p) => {
    const { voucherId, reason } = noteActionSchema.parse(p)
    return tradeClosure.closeStockNote(requireCompany().db, voucherId, reason)
  })
  handle('trade:reopenVoucher', (p) => {
    const { voucherId, reason } = noteActionSchema.parse(p)
    return tradeClosure.reopenStockNote(requireCompany().db, voucherId, reason)
  })
  handle('trade:closeStaleQuotations', (p) => tradeClosure.closeStaleQuotations(requireCompany().db, closeStaleQuotationsSchema.parse(p)))

  handle('master:units:list', () => masters.listUnits(requireCompany().db), 'viewer')
  handle('master:units:create', (p) => masters.createUnit(requireCompany().db, unitInputSchema.parse(p)))
  handle('master:stockGroups:list', () => masters.listStockGroups(requireCompany().db), 'viewer')
  handle('master:stockGroups:create', (p) => masters.createStockGroup(requireCompany().db, stockGroupInputSchema.parse(p)))
  handle('master:stockItems:list', () => masters.listStockItems(requireCompany().db), 'viewer')
  handle('master:stockItems:create', (p) => masters.createStockItem(requireCompany().db, stockItemInputSchema.parse(p)))
  // WP 8.4: the plain "New product" dialog — item + its selling price on the default level, one transaction.
  handle('master:stockItems:quickCreate', (p) => quickCreateItem(requireCompany().db, quickItemSchema.parse(p)))
  handle('master:stockItems:update', (p) => {
    const { id, data } = withIdSchema(stockItemInputSchema).parse(p)
    return masters.updateStockItem(requireCompany().db, id, data)
  })
  handle('master:stockItems:delete', (p) => masters.deleteStockItem(requireCompany().db, idSchema.parse(p).id))
  handle('master:godowns:list', () => masters.listGodowns(requireCompany().db), 'viewer')
  handle('master:godowns:create', (p) => masters.createGodown(requireCompany().db, godownInputSchema.parse(p)))
}
