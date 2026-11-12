// IPC channels for year-end close, vouchers (save / undo / bin / approval queue), outstanding bills.
// Registered from ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is
// Zod-parsed here, every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12
// (HEALTH-4) — the handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with
// origin/main).
import { z } from 'zod'
import * as attachments from './services/attachments'
import { companyAttachmentsDir, companyDir } from './paths'
import { log } from './log'
import { billsOpenSchema, isoDate, periodSchema, voucherInputSchema } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import * as configSvc from './services/config'
import * as vouchers from './services/vouchers'
import * as undo from './services/undo'
import * as analysis from './services/analysis'
import * as yearEnd from './services/yearEnd'
import { dropPendingAttachments, flushCaptureAttachments } from './ai/capture/consume'
import { settleDraftOnSave } from './ai/drafts'
import * as aiStore from './ai/store'
import { approvalPayload, openOfferFor } from './ai/queue'
import { creditOverrideSchema } from '@shared/receivables/schemas'
import { rememberSalePrices } from './services/pricing'
import * as agentBridge from './services/agentBridge'
import { simpleIntentSchema } from '@shared/simple/intents'
import { idSchema, type IpcContext, type IpcHandle, type PostSimpleIntent } from './ipcCommon'

export function registerVouchersIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow, sessionUser }: IpcContext, postSimpleIntent: PostSimpleIntent): void {
  // ---------- year-end close ----------
  const fyStartYearSchema = z.object({ fyStartYear: z.number().int().min(1990).max(2100) })
  handle('yearend:preview', (p) => {
    const { fyStartYear } = fyStartYearSchema.parse(p)
    return yearEnd.closePreview(requireCompany().db, fyStartYear)
  }, 'viewer')
  handle('yearend:close', (p) => {
    const { fyStartYear } = fyStartYearSchema.parse(p)
    const c = requireCompany()
    return yearEnd.postClose(c.db, c.info, fyStartYear)
  }, 'owner')

  // ---------- vouchers ----------
  handle('voucher:list', (p) => {
    const { from, to, voucherTypeId } = periodSchema.extend({ voucherTypeId: z.number().int().positive().optional() }).parse(p)
    return vouchers.listVouchers(requireCompany().db, from, to, voucherTypeId)
  }, 'viewer')
  handle('voucher:get', (p) => vouchers.getVoucher(requireCompany().db, idSchema.parse(p).id), 'viewer')
  // Audit A8 / UX-3: the party picker's "used recently" order (ids, newest first; reads only).
  handle('voucher:recentParties', (p) => {
    const { side } = z.object({ side: z.enum(['sales', 'purchase']) }).strict().parse(p)
    return vouchers.recentParties(requireCompany().db, side)
  }, 'viewer')
  // The voucher save a person makes (editors, and Phase 3b's approval queue): `build` runs inside
  // the save's transaction when a draft is settled (the queue builds the draft's payload there, so
  // a GST ledger the editor would create on first use is rolled back with a refused save).
  const saveVoucherRequest = (
    build: () => z.infer<typeof voucherInputSchema>,
    opts: { id?: number; aiDraftId?: number; creditHoldOverride?: z.infer<typeof creditOverrideSchema> }
  ): ReturnType<typeof vouchers.saveVoucher> => {
    const { id, aiDraftId, creditHoldOverride } = opts
    const c = requireCompany()
    // WP 4.2: only an owner may override a credit hold (any user in a company without users).
    if (creditHoldOverride && c.usersExist && sessionUser()?.role !== 'owner') throw new Error('Only an owner can override a credit hold')
    const saveOpts = creditHoldOverride ? { creditHoldOverride } : {}
    // WP 5.1: a voucher reviewed from an AI draft saves through the normal path; the draft is
    // settled in the same transaction (consumed when still open; otherwise the save goes ahead
    // and the audit trail records that the draft was no longer open).
    let saved: ReturnType<typeof vouchers.saveVoucher>
    if (aiDraftId) {
      try {
        saved = c.db.transaction(() => {
          const v = vouchers.saveVoucher(c.db, build(), id, saveOpts)
          settleDraftOnSave(c.db, aiDraftId, v.id, 'voucher', { companyDir: companyDir(c.slug) })
          return v
        })()
      } catch (err) {
        dropPendingAttachments()
        throw err
      }
      // WP 5.4: a captured bill's file is attached only once the save has committed.
      flushCaptureAttachments()
    } else saved = vouchers.saveVoucher(c.db, build(), id, saveOpts)
    // WP 2.6 "remember last price" (Options toggle; a no-op unless on and this is a sale). Never
    // fails the save it follows.
    try {
      rememberSalePrices(c.db, saved.id)
    } catch (err) {
      log('warn', 'pricing.rememberSalePrices.failed', { error: (err as Error).message })
    }
    // Agent mirror stays fresh while the flag is on — debounced so entry bursts export once.
    if (configSvc.getAgentBridgeEnabled(c.db)) agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: canSeeProfitNow() })
    return saved
  }
  handle('voucher:save', (p) => {
    const { data, id, aiDraftId, creditHoldOverride } = z
      .object({
        data: voucherInputSchema,
        id: z.number().int().positive().optional(),
        aiDraftId: z.number().int().positive().optional(),
        creditHoldOverride: creditOverrideSchema.optional()
      })
      .parse(p)
    return saveVoucherRequest(() => data, { id, aiDraftId, creditHoldOverride })
  })
  // Phase 3b: approve one proposal of the approval queue (main/ai/queue.ts). A draft with an
  // editor form saves through voucher:save's own save above (the payload built by the editor's
  // shared mapping, the draft consumed in the same transaction); an Ask Total offer posts through
  // simple:post's postIntent (below). A memory suggestion is approved through ai:memory:setStatus
  // (no posting right needed). Nothing else is written.
  handle('ai:queue:approve', (p) => {
    const { key, today } = z.object({ key: z.string().regex(/^draft:[1-9]\d*$/), today: isoDate.optional() }).strict().parse(p)
    const id = Number(key.slice('draft:'.length))
    const c = requireCompany()
    const draft = aiStore.getDraft(c.db, id)
    if (draft?.payload.simple) {
      openOfferFor(c.db, c.info, id, today ?? todayISO())
      const intent = simpleIntentSchema.parse({ ...(draft.payload.simple.intent as object), clientId: `queue-draft-${id}` })
      const r = postSimpleIntent(intent, today, id)
      return { key, voucherIds: r.voucherIds }
    }
    const saved = saveVoucherRequest(() => approvalPayload(c.db, c.info, id, today ?? todayISO()), { aiDraftId: id })
    return { key, voucherIds: [saved.id] }
  })
  handle('voucher:delete', (p) => vouchers.deleteVoucher(requireCompany().db, idSchema.parse(p).id))
  handle('voucher:bin', () => vouchers.listBin(requireCompany().db), 'viewer')
  // WP 8.5: a voucher undone with others comes back with its whole undo group.
  handle('voucher:restore', (p) => {
    const { id, creditHoldOverride } = idSchema.extend({ creditHoldOverride: creditOverrideSchema.strict().optional() }).strict().parse(p)
    const c = requireCompany()
    // WP 4.2: restoring a sales invoice / challan to a held party creates credit — owner override only.
    if (creditHoldOverride && c.usersExist && sessionUser()?.role !== 'owner') throw new Error('Only an owner can override a credit hold')
    return undo.restoreFromBin(c.db, id, creditHoldOverride ? { creditHoldOverride } : {})
  })
  const undoIdsSchema = z.object({ voucherIds: z.array(z.number().int().positive()).min(1).max(undo.UNDO_MAX) })
  handle('voucher:undoSave', (p) => undo.undoSave(requireCompany().db, undoIdsSchema.parse(p).voucherIds))
  handle('voucher:saveSummary', (p) => undo.saveSummary(requireCompany().db, undoIdsSchema.parse(p).voucherIds), 'viewer')
  handle('voucher:purge', (p) => {
    const c = requireCompany()
    vouchers.purgeVoucher(c.db, idSchema.parse(p).id)
    // WP 6.4: the purged voucher's attachments (orphan sweep) — never fails the purge itself.
    try {
      attachments.sweepAttachments(c.db, companyAttachmentsDir(c.slug))
    } catch (err) {
      log('warn', 'attachments-sweep-failed', { slug: c.slug, error: err instanceof Error ? err.message : String(err) })
    }
    return null
  }, 'owner')
  handle('voucher:nextNumber', (p) => {
    const { voucherTypeId, date, excludeId } = z
      .object({ voucherTypeId: z.number().int().positive(), date: z.string(), excludeId: z.number().int().positive().optional() })
      .parse(p)
    return { number: vouchers.nextVoucherNumber(requireCompany().db, voucherTypeId, date, excludeId) }
  })
  handle('voucher:numberExists', (p) => {
    const { voucherTypeId, number, excludeId, date } = z
      .object({
        voucherTypeId: z.number().int().positive(),
        number: z.string().trim().min(1).max(40),
        excludeId: z.number().int().positive().optional(),
        // The voucher's date: a series that restarts each FY only clashes within that FY.
        date: isoDate.optional()
      })
      .parse(p)
    return vouchers.voucherNumberExists(requireCompany().db, voucherTypeId, number, excludeId, date)
  })
  handle('voucher:duplicates', (p) => {
    const { data, excludeId } = z.object({ data: voucherInputSchema, excludeId: z.number().int().positive().optional() }).parse(p)
    return vouchers.findDuplicates(requireCompany().db, data, excludeId)
  })

  // ---------- outstanding bills (party picker for receipt/payment "settle against") ----------
  handle('bills:open', (p) => {
    const { partyLedgerId, asOn } = billsOpenSchema.parse(p)
    return analysis.openBills(requireCompany().db, partyLedgerId, asOn)
  }, 'viewer')
}
