// IPC channels for inventory: godowns, batches, stock analysis, stock visibility, manufacture. Registered
// from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed
// here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) —
// the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { shell } from 'electron'
import { z } from 'zod'
import { redactCostSheet, redactProductionRows } from '@shared/profitRedaction'
import {
  batchInputSchema, godownInputSchema, isoDate, priceLevelInputSchema, priceRateInputSchema, stockQuerySchema,
  stockCostAsOfSchema, stockRegisterSchema, stockReorderSchema, stockExpiryReportSchema, stockLabelsSchema, serialsListSchema,
  serialsAvailableSchema
} from '@shared/schemas'
import * as configSvc from './services/config'
import * as masters from './services/masters'
import * as vouchers from './services/vouchers'
import * as stockAnalysis from './services/stockAnalysis'
import * as manufacture from './services/manufacture'
import * as manufactureReports from './services/manufactureReports'
import * as jobWork from './services/jobWork'
import * as serials from './services/serials'
import * as priceLevels from './services/priceLevels'
import { settleDraftOnSave } from './ai/drafts'
import { creditOverrideSchema } from '@shared/receivables/schemas'
import * as agentBridge from './services/agentBridge'
import {
  manufactureCostPreviewSchema, manufactureRegisterSchema, manufactureSaveSchema, stockMovementsSchema, manufactureReportSchema,
  jobWorkChallanSaveSchema, jobWorkPendingSchema
} from '@shared/schemas'
import { writePdfFile } from './services/pdf'
import { auditExport, idSchema, pickExportPath, withIdSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerInventoryIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow, sessionUser }: IpcContext): void {
  // ---------- inventory depth (lane I): godown CRUD, batches, stock analysis ----------
  handle('master:godowns:update', (p) => {
    const { id, data } = withIdSchema(godownInputSchema).parse(p)
    return masters.updateGodown(requireCompany().db, id, data)
  })
  handle('master:godowns:delete', (p) => masters.deleteGodown(requireCompany().db, idSchema.parse(p).id))
  handle('master:batches:list', (p) => {
    const { stockItemId } = z.object({ stockItemId: z.number().int().positive().optional() }).prefault({}).parse(p ?? {})
    return masters.listBatches(requireCompany().db, stockItemId)
  }, 'viewer')
  handle('master:batches:create', (p) => masters.createBatch(requireCompany().db, batchInputSchema.parse(p)))
  handle('stock:summary', (p) => {
    const { asOn, godownId } = stockQuerySchema.parse(p)
    return stockAnalysis.stockSummary(requireCompany().db, asOn, { godownId })
  }, 'viewer')
  handle('stock:byGodown', (p) => {
    const { asOn } = stockQuerySchema.parse(p)
    return stockAnalysis.stockByGodown(requireCompany().db, asOn)
  }, 'viewer')
  handle('stock:batches', (p) => {
    const { asOn, stockItemId } = z.object({ asOn: isoDate, stockItemId: z.number().int().positive().optional() }).parse(p)
    return stockAnalysis.batchStock(requireCompany().db, asOn, stockItemId)
  }, 'viewer')
  handle('stock:expiry', (p) => {
    const { asOn } = stockQuerySchema.parse(p)
    return stockAnalysis.expiryAgeing(requireCompany().db, asOn)
  }, 'viewer')
  handle('stock:negative', (p) => {
    const { asOn } = stockQuerySchema.parse(p)
    return stockAnalysis.negativeStock(requireCompany().db, asOn)
  }, 'viewer')
  handle('stock:costAsOf', (p) => stockAnalysis.costAsOf(requireCompany().db, stockCostAsOfSchema.parse(p)), 'viewer')
  // ---------- stock visibility (WP 2.3) ----------
  handle('stock:register', (p) => {
    const q = stockRegisterSchema.parse(p)
    return stockAnalysis.stockMovements(requireCompany().db, q.itemId, q.from, q.to, q.godownId)
  }, 'viewer')
  handle('stock:reorder', (p) => {
    const q = stockReorderSchema.parse(p)
    return stockAnalysis.reorderPlan(requireCompany().db, q.from, q.to, { onlyBelow: q.onlyBelow })
  }, 'viewer')
  handle('stock:expiryReport', (p) => {
    const q = stockExpiryReportSchema.parse(p)
    return stockAnalysis.expiryReport(requireCompany().db, q.asOn, q.withinDays)
  }, 'viewer')
  handle('stock:labelsHtml', (p) => {
    const c = requireCompany()
    return { html: stockAnalysis.labelsHtml(c.db, { ...stockLabelsSchema.parse(p), caption: c.info.name }) }
  }, 'viewer')
  handle('stock:labelsPdf', async (p) => {
    const q = stockLabelsSchema.parse(p)
    const c = requireCompany()
    const html = stockAnalysis.labelsHtml(c.db, { ...q, caption: c.info.name })
    const target = await pickExportPath(c.slug, { defaultName: `barcode-labels-${q.date}.pdf`, title: 'Save barcode labels', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!target) return { path: '', cancelled: true }
    const path = await writePdfFile(target, html, { pageSize: 'A4', margins: 'none' })
    auditExport(c.db, 'barcode_labels', { items: q.items.length, path })
    void shell.openPath(path)
    return { path }
  }, 'viewer')
  handle('serials:list', (p) => serials.listSerials(requireCompany().db, serialsListSchema.parse(p ?? {})), 'viewer')
  handle('serials:available', (p) => {
    const q = serialsAvailableSchema.parse(p)
    return serials.availableSerials(requireCompany().db, q.stockItemId, q.voucherId)
  }, 'viewer')
  handle('stock:movements', (p) => {
    const { stockItemId, from, to } = stockMovementsSchema.parse(p)
    return stockAnalysis.itemMovements(requireCompany().db, stockItemId, from, to)
  }, 'viewer')

  // ---------- manufacture voucher (WP 2.2) ----------
  handle('manufacture:get', (p) => manufacture.getManufacture(requireCompany().db, idSchema.parse(p).id), 'viewer')
  handle('manufacture:costPreview', (p) => manufacture.costPreview(requireCompany().db, manufactureCostPreviewSchema.parse(p)), 'viewer')
  handle('manufacture:register', (p) => {
    const { from, to, itemId } = manufactureReportSchema.parse(p)
    return manufacture.manufactureRegister(requireCompany().db, from, to, itemId)
  }, 'viewer')
  // WP 2.4 manufacturing reports
  handle('manufacture:production', (p) => {
    const { from, to } = manufactureRegisterSchema.parse(p)
    const rows = manufactureReports.productionRegisterReport(requireCompany().db, from, to)
    // Audit A3: sale value − production cost is a margin.
    return canSeeProfitNow() ? rows : redactProductionRows(rows)
  }, 'viewer')
  handle('manufacture:costSheet', (p) => {
    const { from, to, itemId } = manufactureReportSchema.extend({ itemId: z.number().int().positive() }).parse(p)
    const r = manufactureReports.costSheetReport(requireCompany().db, itemId, from, to)
    return canSeeProfitNow() ? r : { ...r, average: redactCostSheet(r.average), manufactures: r.manufactures.map(redactCostSheet) }
  }, 'viewer')
  handle('manufacture:margin', (p) => {
    const { from, to } = manufactureRegisterSchema.parse(p)
    return manufactureReports.marginReport(requireCompany().db, from, to)
  }, 'viewer')
  handle('manufacture:variance', (p) => {
    const { from, to, itemId } = manufactureReportSchema.parse(p)
    return manufactureReports.materialVarianceReport(requireCompany().db, from, to, itemId)
  }, 'viewer')
  // WP 2.4 job work
  handle('jobWork:get', (p) => jobWork.getJobWorkChallan(requireCompany().db, idSchema.parse(p).id), 'viewer')
  handle('jobWork:saveChallan', (p) => {
    const { id, ...rest } = jobWorkChallanSaveSchema.parse(p)
    const c = requireCompany()
    const saved = jobWork.saveJobWorkChallan(c.db, rest, id)
    if (configSvc.getAgentBridgeEnabled(c.db)) agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: canSeeProfitNow() })
    return saved
  })
  handle('jobWork:sendChallans', (p) => jobWork.sendChallans(requireCompany().db, idSchema.parse(p).id), 'viewer')
  handle('jobWork:pending', (p) => {
    const { asOn, pendingDays } = jobWorkPendingSchema.parse(p)
    return jobWork.materialAtJobWorkers(requireCompany().db, asOn, pendingDays)
  }, 'viewer')
  handle('jobWork:itc04', (p) => {
    const { from, to } = manufactureRegisterSchema.parse(p)
    return jobWork.itc04Data(requireCompany().db, from, to)
  }, 'viewer')
  handle('manufacture:save', (p) => {
    const { data, id, aiDraftId } = manufactureSaveSchema.extend({ aiDraftId: z.number().int().positive().optional() }).parse(p)
    const c = requireCompany()
    // WP 5.3: a manufacture reviewed from an AI draft — the draft is settled in the same transaction.
    const saved =
      aiDraftId && !id
        ? c.db.transaction(() => {
            const v = manufacture.saveManufacture(c.db, data)
            settleDraftOnSave(c.db, aiDraftId, v.id, 'manufacture')
            return v
          })()
        : manufacture.saveManufacture(c.db, data, id)
    if (configSvc.getAgentBridgeEnabled(c.db)) agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: canSeeProfitNow() })
    return saved
  })
  handle('master:priceLevels:list', () => priceLevels.listPriceLevels(requireCompany().db), 'viewer')
  handle('master:priceLevels:create', (p) => priceLevels.savePriceLevel(requireCompany().db, priceLevelInputSchema.parse(p)))
  handle('master:priceLevels:update', (p) => {
    const { id, data } = withIdSchema(priceLevelInputSchema).parse(p)
    return priceLevels.savePriceLevel(requireCompany().db, data, id)
  })
  handle('master:priceLevels:delete', (p) => priceLevels.deletePriceLevel(requireCompany().db, idSchema.parse(p).id))
  handle('priceLevels:rates', (p) => {
    const { priceLevelId } = z.object({ priceLevelId: z.number().int().positive() }).parse(p)
    return priceLevels.listRates(requireCompany().db, priceLevelId)
  }, 'viewer')
  handle('priceLevels:saveRate', (p) => priceLevels.saveRate(requireCompany().db, priceRateInputSchema.parse(p)))
  handle('priceLevels:deleteRate', (p) => priceLevels.deleteRate(requireCompany().db, idSchema.parse(p).id))
  handle('priceLevels:rateFor', (p) => {
    const q = z.object({ priceLevelId: z.number().int().positive(), stockItemId: z.number().int().positive(), date: isoDate }).parse(p)
    return priceLevels.rateFor(requireCompany().db, q.priceLevelId, q.stockItemId, q.date)
  }, 'viewer')
  handle('pdc:list', () => vouchers.pdcRegister(requireCompany().db), 'viewer')
  handle('pdc:mature', (p) => {
    const { id, creditHoldOverride } = idSchema.extend({ creditHoldOverride: creditOverrideSchema.strict().optional() }).strict().parse(p)
    const c = requireCompany()
    // WP 4.2: a post-dated sales invoice maturing to a held party creates credit — owner override only.
    if (creditHoldOverride && c.usersExist && sessionUser()?.role !== 'owner') throw new Error('Only an owner can override a credit hold')
    vouchers.maturePdcNow(c.db, id, creditHoldOverride ? { creditHoldOverride } : {})
    return null
  })
}
