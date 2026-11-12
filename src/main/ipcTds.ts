// IPC channels for TDS, the TDS screen and TCS. Registered from ipc.ts with its `handle` (role gate + { ok,
// data | error } envelope); every payload is Zod-parsed here, every write channel is mapped in
// auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were moved, not rewritten
// (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { shell } from 'electron'
import { slugify } from './paths'
import {
  tdsExport26qSchema, tdsEnsurePayableSchema, tdsSectionInputSchema, tdsSuggestSchema, tdsSummarySchema, tdsRateInputSchema,
  tdsRatesQuerySchema, tdsCertificateInputSchema, tdsCertificatesQuerySchema, tdsChallanInputSchema, tdsChallansQuerySchema,
  tdsAllocateSchema, tdsUnallocateSchema, tdsUnallocatedSchema, tdsEligibleSchema, tdsDeductedSchema, tdsApplySchema,
  tdsApplyManySchema, tdsVoucherSchema, tdsExemptSchema, tdsQuarterSchema, tdsChallanFromPaymentSchema, tdsChallanRowsSchema,
  tcsSuggestSchema, tcsStatutoryAddSchema, tdsChallanInterestSchema, tdsAutoAllocateSchema, tdsForm16aSchema,
  tdsLedgerSummarySchema
} from '@shared/schemas'
import * as tds from './services/tds'
import * as tdsWb from './services/tdsWorkbench'
import * as tcsSvc from './services/tcs'
import * as tcsWb from './services/tcsWorkbench'
import { renderForm16aHtml } from '@shared/print/form16a'
import { plexFontFaceCss } from './services/printFonts'
import { writeExportPdf } from './services/pdf'
import { auditExport, idSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerTdsIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- TDS ----------
  handle('tds:sections', () => tds.listSections(requireCompany().db), 'viewer')
  handle('tds:sectionSave', (p) => tds.saveSection(requireCompany().db, tdsSectionInputSchema.parse(p)), 'owner')
  handle('tds:suggest', (p) => {
    const { partyLedgerId, base, date, expenseLedgerId, excludeVoucherId, sectionId, voucherKind } = tdsSuggestSchema.parse(p)
    // Read-only (runs as the user types) — never creates the payable ledger.
    return tds.tdsSuggestion(requireCompany().db, partyLedgerId, base, date, { expenseLedgerId, excludeVoucherId, sectionId, voucherKind })
  })
  // Effective-dated rate table — section master data, owner-edited like tds:sectionSave.
  handle('tds:rates', (p) => tds.listRates(requireCompany().db, tdsRatesQuerySchema.parse(p ?? {}).sectionId), 'viewer')
  handle('tds:rateSave', (p) => tds.saveRate(requireCompany().db, tdsRateInputSchema.parse(p)), 'owner')
  handle('tds:rateDelete', (p) => tds.deleteRate(requireCompany().db, idSchema.parse(p).id), 'owner')
  // Lower-deduction certificates are party data (like the PAN on the ledger): accountant+.
  handle('tds:certificates', (p) => tds.listCertificates(requireCompany().db, tdsCertificatesQuerySchema.parse(p ?? {}).ledgerId), 'viewer')
  handle('tds:certificateSave', (p) => tds.saveCertificate(requireCompany().db, tdsCertificateInputSchema.parse(p)))
  handle('tds:certificateDelete', (p) => tds.deleteCertificate(requireCompany().db, idSchema.parse(p).id))
  // Challans + allocation: accountant+ edits, viewer reads.
  handle('tds:challans', (p) => {
    const { fyStartYear, quarter } = tdsChallansQuerySchema.parse(p)
    return tds.listChallans(requireCompany().db, fyStartYear, quarter)
  }, 'viewer')
  handle('tds:challanSave', (p) => tds.saveChallan(requireCompany().db, tdsChallanInputSchema.parse(p)))
  handle('tds:challanDelete', (p) => tds.deleteChallan(requireCompany().db, idSchema.parse(p).id))
  handle('tds:allocate', (p) => {
    const { challanId, entryIds } = tdsAllocateSchema.parse(p)
    return tds.allocateEntries(requireCompany().db, challanId, entryIds)
  })
  handle('tds:unallocate', (p) => tds.unallocateEntries(requireCompany().db, tdsUnallocateSchema.parse(p).entryIds))
  handle('tds:unallocated', (p) => {
    const { fyStartYear, quarter } = tdsUnallocatedSchema.parse(p)
    return tds.unallocatedEntries(requireCompany().db, fyStartYear, quarter as 1 | 2 | 3 | 4 | undefined)
  }, 'viewer')
  // Thin wrapper kept for callers that want the tagged payable ledger up front; entry screens
  // no longer call it — saveVoucher creates the ledger inside the save (tds.autoPayable).
  handle('tds:ensurePayable', (p) => {
    const { sectionId } = tdsEnsurePayableSchema.parse(p)
    return { ledgerId: tds.ensureTdsPayableLedger(requireCompany().db, sectionId) }
  })
  handle('tds:summary', (p) => {
    const { fyStartYear } = tdsSummarySchema.parse(p)
    return tds.tdsSummary(requireCompany().db, fyStartYear)
  }, 'viewer')
  handle('tds:export26q', (p) => {
    const { fyStartYear, quarter } = tdsExport26qSchema.parse(p)
    const c = requireCompany()
    const path = tds.export26qCsv(c.db, c.info, c.slug, fyStartYear, quarter as 1 | 2 | 3 | 4)
    auditExport(c.db, 'tds_26q', { fyStartYear, quarter, path })
    shell.showItemInFolder(path)
    return { path }
  })

  // ---------- TDS screen (WP 3.2): reads for viewers, voucher edits / challans accountant+ ----------
  handle('tds:eligible', (p) => {
    const { from, to, includeExempt } = tdsEligibleSchema.parse(p)
    return tdsWb.tdsEligible(requireCompany().db, from, to, { includeExempt })
  }, 'viewer')
  handle('tds:deducted', (p) => {
    const { from, to } = tdsDeductedSchema.parse(p)
    return tdsWb.tdsDeducted(requireCompany().db, from, to)
  }, 'viewer')
  handle('tds:ledgerSummary', (p) => {
    const { fyStartYear, quarter } = tdsLedgerSummarySchema.parse(p)
    return tdsWb.tdsLedgerSummary(requireCompany().db, fyStartYear, quarter as 0 | 1 | 2 | 3 | 4)
  }, 'viewer')
  handle('tds:applyToVoucher', (p) => tdsWb.applyTdsToVoucher(requireCompany().db, tdsApplySchema.parse(p)))
  // Bulk Move to TDS: each voucher on its own (one refusal doesn't undo the others).
  handle('tds:applyMany', (p) => {
    const { voucherIds } = tdsApplyManySchema.parse(p)
    const db = requireCompany().db
    return voucherIds.map((voucherId) => {
      try {
        tdsWb.applyTdsToVoucher(db, { voucherId })
        return { voucherId, ok: true as const }
      } catch (err) {
        return { voucherId, ok: false as const, error: (err as Error).message }
      }
    })
  })
  handle('tds:removeFromVoucher', (p) => tdsWb.removeTdsFromVoucher(requireCompany().db, tdsVoucherSchema.parse(p).voucherId))
  handle('tds:exempt', (p) => {
    const { voucherId, reason } = tdsExemptSchema.parse(p)
    tdsWb.exemptVoucher(requireCompany().db, voucherId, reason)
    return null
  })
  handle('tds:unexempt', (p) => {
    tdsWb.unexemptVoucher(requireCompany().db, tdsVoucherSchema.parse(p).voucherId)
    return null
  })
  handle('tds:exemption', (p) => ({ reason: tdsWb.exemptionOf(requireCompany().db, tdsVoucherSchema.parse(p).voucherId) }), 'viewer')
  handle('tds:paymentCandidates', (p) => tdsWb.tdsPaymentCandidates(requireCompany().db, tdsSummarySchema.parse(p).fyStartYear), 'viewer')
  handle('tds:challanRows', (p) => {
    const { fyStartYear, quarter, rateBp } = tdsChallanRowsSchema.parse(p)
    return tdsWb.challanRows(requireCompany().db, fyStartYear, quarter, rateBp)
  }, 'viewer')
  handle('tds:challanFromPayment', (p) => {
    const input = tdsChallanFromPaymentSchema.parse(p)
    return tdsWb.challanFromPayment(requireCompany().db, {
      ...input, quarter: (input.quarter ?? null) as 1 | 2 | 3 | 4 | null
    })
  })
  handle('tds:autoAllocate', (p) => ({ entryIds: tdsWb.autoAllocate(requireCompany().db, tdsAutoAllocateSchema.parse(p).challanId) }))
  handle('tds:challanInterest', (p) => {
    const { challanId, rateBp } = tdsChallanInterestSchema.parse(p)
    return tdsWb.challanInterest(requireCompany().db, challanId, rateBp)
  }, 'viewer')
  handle('tds:form26q', (p) => {
    const { fyStartYear, quarter } = tdsQuarterSchema.parse(p)
    return tdsWb.form26qData(requireCompany().db, fyStartYear, quarter as 1 | 2 | 3 | 4)
  }, 'viewer')
  handle('tds:form16a', (p) => {
    const { fyStartYear, quarter, partyLedgerId } = tdsForm16aSchema.parse(p)
    const c = requireCompany()
    return tdsWb.form16aData(c.db, c.info, fyStartYear, quarter as 1 | 2 | 3 | 4, partyLedgerId)
  }, 'viewer')
  handle('tds:form16aPdf', async (p) => {
    const { fyStartYear, quarter, partyLedgerId } = tdsForm16aSchema.parse(p)
    const c = requireCompany()
    const data = tdsWb.form16aData(c.db, c.info, fyStartYear, quarter as 1 | 2 | 3 | 4, partyLedgerId)
    const html = renderForm16aHtml(data, plexFontFaceCss)
    const who = partyLedgerId != null && data.parties[0] ? `-${slugify(data.parties[0].partyName)}` : ''
    const path = await writeExportPdf(c.slug, `form16a-data-${fyStartYear}-Q${quarter}${who}.pdf`, html, { pageSize: 'A4' })
    auditExport(c.db, 'tds_form16a', { fyStartYear, quarter, partyLedgerId: partyLedgerId ?? null, path })
    shell.showItemInFolder(path)
    return { path }
  }, 'viewer')

  // ---------- TCS (WP 3.3) ----------
  // The same section / rate / certificate / challan / entry machinery as TDS, kind 'tcs' (shared
  // tables, migration 027); the TCS-only parts (suggestion, Eligible, Move to TCS, 27EQ / 27D)
  // live in services/tcs.ts and tcsWorkbench.ts.
  handle('tcs:sections', () => tds.listSections(requireCompany().db, 'tcs'), 'viewer')
  handle('tcs:sectionSave', (p) => tds.saveSection(requireCompany().db, tdsSectionInputSchema.parse(p), 'tcs'), 'owner')
  handle('tcs:suggest', (p) => tcsSvc.tcsSuggestion(requireCompany().db, tcsSuggestSchema.parse(p)), 'viewer')
  // Statutory sections a company may lack (s.206C(1C)) and the owner's "add them" (no migration;
  // cited rows in src/shared/tcsSources.ts, audited tdsSection / tdsRate creates).
  handle('tcs:statutory', () => tcsSvc.statutoryTcsSections(requireCompany().db), 'viewer')
  handle('tcs:statutoryAdd', (p) => tcsSvc.addStatutoryTcsSections(requireCompany().db, tcsStatutoryAddSchema.parse(p ?? {}).codes), 'owner')
  handle('tcs:rates', (p) => tds.listRates(requireCompany().db, tdsRatesQuerySchema.parse(p ?? {}).sectionId, 'tcs'), 'viewer')
  handle('tcs:rateSave', (p) => tds.saveRate(requireCompany().db, tdsRateInputSchema.parse(p)), 'owner')
  handle('tcs:rateDelete', (p) => tds.deleteRate(requireCompany().db, idSchema.parse(p).id), 'owner')
  handle('tcs:certificates', (p) => tds.listCertificates(requireCompany().db, tdsCertificatesQuerySchema.parse(p ?? {}).ledgerId, 'tcs'), 'viewer')
  handle('tcs:certificateSave', (p) => tds.saveCertificate(requireCompany().db, tdsCertificateInputSchema.parse(p), 'tcs'))
  handle('tcs:certificateDelete', (p) => tds.deleteCertificate(requireCompany().db, idSchema.parse(p).id))
  handle('tcs:challanSave', (p) => tds.saveChallan(requireCompany().db, tdsChallanInputSchema.parse(p), 'tcs'))
  handle('tcs:challanDelete', (p) => tds.deleteChallan(requireCompany().db, idSchema.parse(p).id))
  handle('tcs:allocate', (p) => {
    const { challanId, entryIds } = tdsAllocateSchema.parse(p)
    return tds.allocateEntries(requireCompany().db, challanId, entryIds)
  })
  handle('tcs:unallocate', (p) => tds.unallocateEntries(requireCompany().db, tdsUnallocateSchema.parse(p).entryIds))
  handle('tcs:unallocated', (p) => {
    const { fyStartYear, quarter } = tdsUnallocatedSchema.parse(p)
    return tds.unallocatedEntries(requireCompany().db, fyStartYear, quarter as 1 | 2 | 3 | 4 | undefined, 'tcs')
  }, 'viewer')
  handle('tcs:eligible', (p) => {
    const { from, to, includeExempt } = tdsEligibleSchema.parse(p)
    return tcsWb.tcsEligible(requireCompany().db, from, to, { includeExempt })
  }, 'viewer')
  handle('tcs:deducted', (p) => {
    const { from, to } = tdsDeductedSchema.parse(p)
    return tdsWb.tdsDeducted(requireCompany().db, from, to, 'tcs')
  }, 'viewer')
  handle('tcs:ledgerSummary', (p) => {
    const { fyStartYear, quarter } = tdsLedgerSummarySchema.parse(p)
    return tdsWb.tdsLedgerSummary(requireCompany().db, fyStartYear, quarter as 0 | 1 | 2 | 3 | 4, 'tcs')
  }, 'viewer')
  handle('tcs:applyToVoucher', (p) => tcsWb.applyTcsToVoucher(requireCompany().db, tdsApplySchema.parse(p)))
  handle('tcs:applyMany', (p) => {
    const { voucherIds } = tdsApplyManySchema.parse(p)
    const db = requireCompany().db
    return voucherIds.map((voucherId) => {
      try {
        tcsWb.applyTcsToVoucher(db, { voucherId })
        return { voucherId, ok: true as const }
      } catch (err) {
        return { voucherId, ok: false as const, error: (err as Error).message }
      }
    })
  })
  handle('tcs:removeFromVoucher', (p) => tcsWb.removeTcsFromVoucher(requireCompany().db, tdsVoucherSchema.parse(p).voucherId))
  handle('tcs:exempt', (p) => {
    const { voucherId, reason } = tdsExemptSchema.parse(p)
    tdsWb.exemptVoucher(requireCompany().db, voucherId, reason, 'tcs')
    return null
  })
  handle('tcs:unexempt', (p) => {
    tdsWb.unexemptVoucher(requireCompany().db, tdsVoucherSchema.parse(p).voucherId, 'tcs')
    return null
  })
  handle('tcs:exemption', (p) => ({ reason: tdsWb.exemptionOf(requireCompany().db, tdsVoucherSchema.parse(p).voucherId, 'tcs') }), 'viewer')
  handle('tcs:paymentCandidates', (p) => tdsWb.tdsPaymentCandidates(requireCompany().db, tdsSummarySchema.parse(p).fyStartYear, 'tcs'), 'viewer')
  handle('tcs:challanRows', (p) => {
    const { fyStartYear, quarter, rateBp } = tdsChallanRowsSchema.parse(p)
    return tdsWb.challanRows(requireCompany().db, fyStartYear, quarter, rateBp, 'tcs')
  }, 'viewer')
  handle('tcs:challanFromPayment', (p) => {
    const input = tdsChallanFromPaymentSchema.parse(p)
    return tdsWb.challanFromPayment(requireCompany().db, { ...input, quarter: (input.quarter ?? null) as 1 | 2 | 3 | 4 | null }, 'tcs')
  })
  handle('tcs:autoAllocate', (p) => ({ entryIds: tdsWb.autoAllocate(requireCompany().db, tdsAutoAllocateSchema.parse(p).challanId) }))
  handle('tcs:challanInterest', (p) => {
    const { challanId, rateBp } = tdsChallanInterestSchema.parse(p)
    return tdsWb.challanInterest(requireCompany().db, challanId, rateBp)
  }, 'viewer')
  handle('tcs:form27eq', (p) => {
    const { fyStartYear, quarter } = tdsQuarterSchema.parse(p)
    return tcsWb.form27eqData(requireCompany().db, fyStartYear, quarter as 1 | 2 | 3 | 4)
  }, 'viewer')
  handle('tcs:export27eq', (p) => {
    const { fyStartYear, quarter } = tdsQuarterSchema.parse(p)
    const c = requireCompany()
    const path = tcsWb.export27eqCsv(c.db, c.slug, fyStartYear, quarter as 1 | 2 | 3 | 4)
    auditExport(c.db, 'tcs_27eq', { fyStartYear, quarter, path })
    shell.showItemInFolder(path)
    return { path }
  }, 'viewer')
  handle('tcs:form27d', (p) => {
    const { fyStartYear, quarter, partyLedgerId } = tdsForm16aSchema.parse(p)
    const c = requireCompany()
    return tcsWb.form27dData(c.db, c.info, fyStartYear, quarter as 1 | 2 | 3 | 4, partyLedgerId)
  }, 'viewer')
  handle('tcs:form27dPdf', async (p) => {
    const { fyStartYear, quarter, partyLedgerId } = tdsForm16aSchema.parse(p)
    const c = requireCompany()
    const data = tcsWb.form27dData(c.db, c.info, fyStartYear, quarter as 1 | 2 | 3 | 4, partyLedgerId)
    const html = renderForm16aHtml(data, plexFontFaceCss, 'tcs')
    const who = partyLedgerId != null && data.parties[0] ? `-${slugify(data.parties[0].partyName)}` : ''
    const path = await writeExportPdf(c.slug, `form27d-data-${fyStartYear}-Q${quarter}${who}.pdf`, html, { pageSize: 'A4' })
    auditExport(c.db, 'tcs_form27d', { fyStartYear, quarter, partyLedgerId: partyLedgerId ?? null, path })
    shell.showItemInFolder(path)
    return { path }
  }, 'viewer')
}
