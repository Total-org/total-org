// IPC channels for masters, search, cost centres, features + invoice print config, currencies + BOM.
// Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is
// Zod-parsed here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12
// (HEALTH-4) — the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with
// origin/main).
import { z } from 'zod'
import { redactChartOfAccounts, redactLedgerBalances } from '@shared/profitRedaction'
import {
  ccStatementSchema, costCentreInputSchema, groupInputSchema, ledgerInputSchema, periodSchema, searchGlobalSchema,
  searchQuerySchema, voucherTypeInputSchema
} from '@shared/schemas'
import * as configSvc from './services/config'
import { unusedFeatures } from './services/featureUsage'
import * as masters from './services/masters'
import * as reports from './services/reports'
import * as extras from './services/extras'
import * as costCentres from './services/costCentres'
import * as bomSvc from './services/bom'
import { bomVersionInputSchema, bomExplodeSchema } from '@shared/schemas'
import { globalSearch, search } from './services/search'
import { gstProfilePatchSchema } from '@shared/gst/filing'
import { bomInputSchema } from '@shared/schemas'
import { featuresSchema, type FeaturesView } from '@shared/features'
import { invoiceConfigSchema } from '@shared/invoiceConfig'
import { idSchema, withIdSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerMastersIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow }: IpcContext): void {
  // ---------- masters ----------
  handle('master:groups:list', () => masters.listGroups(requireCompany().db), 'viewer')
  handle('master:groups:tree', () => masters.groupTree(requireCompany().db), 'viewer')
  handle('master:chartOfAccounts', (p) => {
    const { asOn } = z.object({ asOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(p)
    const db = requireCompany().db
    const chart = reports.chartOfAccounts(db, asOn)
    // Audit A3: the income / expense totals add up to the profit, as in the trial balance.
    return canSeeProfitNow() ? chart : redactChartOfAccounts(chart, reports.pnlLedgerIds(db))
  }, 'viewer')
  handle('master:groups:create', (p) => masters.createGroup(requireCompany().db, groupInputSchema.parse(p)))
  handle('master:groups:update', (p) => {
    const { id, data } = withIdSchema(groupInputSchema).parse(p)
    return masters.updateGroup(requireCompany().db, id, data)
  })
  handle('master:groups:delete', (p) => masters.deleteGroup(requireCompany().db, idSchema.parse(p).id))

  handle('master:ledgers:list', () => masters.listLedgers(requireCompany().db), 'viewer')
  handle('master:ledgers:create', (p) => masters.createLedger(requireCompany().db, ledgerInputSchema.parse(p)))
  handle('master:ledgers:update', (p) => {
    const { id, data } = withIdSchema(ledgerInputSchema).parse(p)
    return masters.updateLedger(requireCompany().db, id, data)
  })
  handle('master:ledgers:delete', (p) => masters.deleteLedger(requireCompany().db, idSchema.parse(p).id))
  handle('master:ledgerBalances', (p) => {
    const { asOn } = z.object({ asOn: z.string() }).parse(p)
    const db = requireCompany().db
    const rows = masters.ledgerBalances(db, asOn)
    return canSeeProfitNow() ? rows : redactLedgerBalances(rows, reports.pnlLedgerIds(db))
  }, 'viewer')

  handle('master:voucherTypes:list', () => masters.listVoucherTypes(requireCompany().db), 'viewer')
  handle('master:voucherTypes:create', (p) => masters.createVoucherType(requireCompany().db, voucherTypeInputSchema.parse(p)))
  handle('master:voucherTypes:update', (p) => {
    const { id, data } = withIdSchema(voucherTypeInputSchema).parse(p)
    return masters.updateVoucherType(requireCompany().db, id, data)
  })

  // ---------- search ----------
  handle('search:global', (p) => globalSearch(requireCompany().db, searchGlobalSchema.parse(p).q), 'viewer')
  handle('search:query', (p) => {
    const { q, ...opts } = searchQuerySchema.parse(p)
    return search(requireCompany().db, q, opts)
  }, 'viewer')

  // ---------- cost centres ----------
  handle('cc:list', () => costCentres.listCostCentres(requireCompany().db), 'viewer')
  handle('cc:save', (p) => {
    const { id, data } = z.object({ id: z.number().int().positive().optional(), data: costCentreInputSchema }).parse(p)
    return costCentres.saveCostCentre(requireCompany().db, data, id)
  })
  handle('cc:delete', (p) => costCentres.deleteCostCentre(requireCompany().db, idSchema.parse(p).id))
  handle('cc:report', (p) => {
    const { from, to } = periodSchema.parse(p)
    return costCentres.ccReport(requireCompany().db, from, to)
  }, 'viewer')
  handle('cc:statement', (p) => {
    const { ccId, from, to } = ccStatementSchema.parse(p)
    return costCentres.ccStatement(requireCompany().db, ccId, from, to)
  }, 'viewer')

  // ---------- F11 features + F12 invoice print config ----------
  // The stored flags + the hideable features this company has no data for (feature cleanup).
  handle('config:features:get', (): FeaturesView => {
    const db = requireCompany().db
    return { ...configSvc.getFeatures(db), unused: unusedFeatures(db) }
  }, 'viewer')
  handle('config:features:set', (p) => configSvc.setFeatures(requireCompany().db, featuresSchema.parse(p)), 'owner')
  // WP 8.3: GSTR-1 filing frequency (monthly / quarterly QRMP), meta `gstProfile`.
  handle('gstProfile:get', () => configSvc.getGstProfile(requireCompany().db), 'viewer')
  handle('gstProfile:set', (p) => configSvc.setGstProfile(requireCompany().db, gstProfilePatchSchema.parse(p)), 'owner')
  handle('config:invoice:get', () => configSvc.getInvoiceConfig(requireCompany().db), 'viewer')
  handle('config:invoice:set', (p) => configSvc.setInvoiceConfig(requireCompany().db, invoiceConfigSchema.parse(p)), 'owner')

  // ---------- currencies + BOM ----------
  handle('currency:list', () => extras.listCurrencies(requireCompany().db), 'viewer')
  handle('bom:get', (p) => extras.getBom(requireCompany().db, z.object({ itemId: z.number().int().positive() }).parse(p).itemId), 'viewer')
  handle('bom:set', (p) => extras.setBom(requireCompany().db, bomInputSchema.parse(p)))
  handle('bom:items', () => extras.itemsWithBom(requireCompany().db), 'viewer')
  // WP 2.4: BOM versions + explosion
  handle('bom:versions', (p) => bomSvc.listBomVersions(requireCompany().db, z.object({ itemId: z.number().int().positive().optional() }).parse(p ?? {}).itemId), 'viewer')
  handle('bom:saveVersion', (p) => bomSvc.saveBomVersion(requireCompany().db, bomVersionInputSchema.parse(p)))
  handle('bom:deleteVersion', (p) => bomSvc.deleteBomVersion(requireCompany().db, idSchema.parse(p).id))
  handle('bom:explode', (p) => bomSvc.explode(requireCompany().db, bomExplodeSchema.parse(p)), 'viewer')
}
