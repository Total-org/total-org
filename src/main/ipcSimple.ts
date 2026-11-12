// IPC channels for simple mode flows: setup wizard, openings, simple:post / preview / hand-off, Sell / Buy
// / Money / Stock / Reports / Taxes / People / Returns / Bank reads. Registered from ipc.ts with its
// `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed here, every write
// channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the handlers were
// moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { z } from 'zod'
import { LANGUAGES } from '@shared/i18n'
import { isoDate } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import * as configSvc from './services/config'
import { homeAsOn } from './services/simpleHome'
import { settleAskDraft } from './assist/settle'
import * as agentBridge from './services/agentBridge'
import { createCompanyFromSetup } from './services/companySetup'
import * as simplePost from './services/simplePost'
import * as simpleHandoff from './services/simpleHandoff'
import * as simpleMoney from './services/simpleMoney'
import * as simplePeople from './services/simplePeople'
import * as simpleSell from './services/simpleSell'
import * as simpleReturns from './services/simpleReturns'
import * as simpleBank from './services/simpleBank'
import * as simpleBuy from './services/simpleBuy'
import * as simpleStock from './services/simpleStock'
import * as simpleReports from './services/simpleReports'
import * as simpleTaxes from './services/simpleTaxes'
import { doingQuerySchema, owedQuerySchema } from '@shared/simple/reports'
import { gstFiledInputSchema, taxesQuerySchema } from '@shared/simple/taxes'
import { simpleIntentSchema } from '@shared/simple/intents'
import { CARRY_FLOWS } from '@shared/simple/carryBack'
import { peopleListSchema, personRemindedSchema, personUpdateSchema, personViewSchema } from '@shared/simple/people'
import { bankAcceptSchema } from '@shared/simple/bank'
import { simpleSetupSchema } from '@shared/simple/setup'
import { simpleOpeningsSchema } from '@shared/simple/openings'
import * as openingsSvc from './services/openings'
import { type IpcContext, type IpcHandle, type PostSimpleIntent } from './ipcCommon'

export function registerSimpleIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow, sessionUser }: IpcContext): { postSimpleIntent: PostSimpleIntent } {
  // WP 8.3: the plain-language setup wizard — a company from the answers (business type preset,
  // GST, stock, start date) in one transaction; services/companySetup.ts. Default mode simple (D2).
  handle('simple:setup', (payload) => createCompanyFromSetup(simpleSetupSchema.parse(payload), todayISO()))

  // WP 8.7: the plain-language opening setup (services/openings.ts) — what a continuing business
  // had on day one. `get` reads the books' openings; `preview` rehearses the run (rolled back) for
  // the confirm step; `simple:openings` writes it in one transaction once the user confirmed the
  // owner's-money figure; `skip` = "I started fresh" (meta ui.startedFresh).
  handle('simple:openings:get', () => openingsSvc.openingsState(requireCompany().db), 'viewer')
  handle('simple:openings:preview', (payload) => openingsSvc.previewOpenings(requireCompany().db, simpleOpeningsSchema.parse(payload)))
  handle('simple:openings', (payload) => openingsSvc.applyOpenings(requireCompany().db, simpleOpeningsSchema.parse(payload)))
  handle('simple:openings:skip', (payload) => {
    z.object({}).strict().optional().parse(payload)
    return openingsSvc.skipOpenings(requireCompany().db)
  })

  // WP 9.3: the simple Buy screens' reads (services/simpleBuy.ts) — the form's suppliers, cash /
  // bank accounts and their defaults (WP 5.6 memory "Pay from", else the counter's), the purchase
  // list with what is still due on each bill (the Outstandings allocation as on today) and one
  // bill's simple view. Writing goes through simple:post only.
  handle('simple:buy:setup', (payload) => {
    z.object({}).strict().optional().parse(payload)
    return simpleBuy.buySetup(requireCompany().db)
  }, 'viewer')
  handle('simple:purchases', (payload) => {
    const { from, to, today } = z.object({ from: isoDate, to: isoDate, today: isoDate.optional() }).strict().parse(payload)
    return simpleBuy.purchasesList(requireCompany().db, from, to, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:purchase', (payload) => {
    const { id, today } = z.object({ id: z.number().int().positive(), today: isoDate.optional() }).strict().parse(payload)
    return simpleBuy.purchaseView(requireCompany().db, id, homeAsOn(today, todayISO()))
  }, 'viewer')

  // WP 9.1: the ONE write path of the simple screens (services/simplePost.ts) — an intent mapped to
  // the editors' own form state and saved through saveVoucher in one transaction (idempotent by
  // clientId; the vouchers come back together for the save card's grouped Undo). `preview`
  // rehearses the same run (always rolled back) and says what will be recorded.
  const simpleIntentPayload = z.object({ intent: simpleIntentSchema, today: isoDate.optional() }).strict()
  handle('simple:preview', (payload) => {
    const { intent, today } = simpleIntentPayload.parse(payload)
    const c = requireCompany()
    return simplePost.previewIntent(c.db, c.info, intent, today ?? todayISO())
  }, 'viewer')
  // WP 10.1: `aiDraftId` = the flow was opened from an Ask Total draft — the save consumes it in
  // the same transaction (only an open ask-total draft of the same kind; anything else is ignored).
  const simplePostPayload = simpleIntentPayload.extend({ aiDraftId: z.number().int().positive().optional() }).strict()
  // WP 9.10: "Accountant view" of an unsaved simple form — the editors' own form state for the
  // current answers (the same mapping, rolled back); "Back to simple" — what a voucher / ledger is.
  handle('simple:intentForm', (payload) => {
    const { intent, today } = simpleIntentPayload.parse(payload)
    const c = requireCompany()
    return simplePost.intentForm(c.db, c.info, intent, today ?? todayISO())
  }, 'viewer')
  // WP 9.10 follow-up: "Back to simple" from an unsaved hand-off editor — its changes carried back
  // into the simple form (pure carryBack over simple:post's context, rolled back). The entries and
  // the form are the renderer's own state handed through; carryBack reads only their known fields.
  const handoffEntryPayload = z
    .object({
      role: z.string(),
      kind: z.string(),
      voucherTypeId: z.number().int(),
      amount: z.number().int(),
      form: z.enum(['invoice', 'accounting', 'physical', 'manufacture']),
      state: z.object({ date: isoDate }).passthrough(),
      pending: z.record(z.string(), z.unknown()).optional()
    })
    .strict()
  handle('simple:carryBack', (payload) => {
    const p = z
      .object({
        flow: z.enum(CARRY_FLOWS),
        intent: simpleIntentSchema,
        original: handoffEntryPayload,
        current: handoffEntryPayload,
        base: z.record(z.string(), z.unknown()),
        today: isoDate.optional()
      })
      .strict()
      .parse(payload)
    const c = requireCompany()
    return simpleHandoff.carryBackForm(c.db, c.info, p as unknown as simpleHandoff.CarryBackRequest, p.today ?? todayISO())
  }, 'viewer')
  handle('simple:handoffTarget', (payload) => {
    const q = z.object({ voucherId: z.number().int().positive().optional(), ledgerId: z.number().int().positive().optional(), open: z.boolean().optional() }).strict().parse(payload)
    return simpleHandoff.handoffFacts(requireCompany().db, q)
  }, 'viewer')
  // simple:post's post (also Phase 3b's approval queue for an Ask Total offer).
  const postSimpleIntent = (intent: z.infer<typeof simpleIntentSchema>, today: string | undefined, aiDraftId: number | undefined): ReturnType<typeof simplePost.postIntent> => {
    const c = requireCompany()
    const out = c.db.transaction(() => {
      const r = simplePost.postIntent(c.db, c.info, intent, today ?? todayISO())
      if (aiDraftId && !r.replayed) settleAskDraft(c.db, aiDraftId, intent.kind, r.voucherIds)
      return r
    })()
    if (!out.replayed && configSvc.getAgentBridgeEnabled(c.db)) agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: canSeeProfitNow() })
    return out
  }
  handle('simple:post', (payload) => {
    const { intent, today, aiDraftId } = simplePostPayload.parse(payload)
    return postSimpleIntent(intent, today, aiDraftId)
  })

  // WP 9.4: the simple Money screens' reads (services/simpleMoney.ts) — the forms' customers,
  // suppliers, cash / bank accounts and their defaults (WP 5.6 memory, else the counter's), a
  // party's open bills (the Outstandings allocation), the money list and one entry's view.
  // Writing goes through simple:post only.
  handle('simple:money:setup', (payload) => {
    const opts = z.object({ customerCredits: z.boolean().optional() }).strict().optional().parse(payload)
    return simpleMoney.moneySetup(requireCompany().db, opts ?? {})
  }, 'viewer')
  handle('simple:money:bills', (payload) => {
    const { partyId, date } = z.object({ partyId: z.number().int().positive(), date: isoDate }).strict().parse(payload)
    return simpleMoney.moneyBills(requireCompany().db, partyId, date)
  }, 'viewer')
  handle('simple:money:list', (payload) => {
    // `today` = the working date the list's range is built on, so "dated ahead" agrees with it.
    const { from, to, today } = z.object({ from: isoDate, to: isoDate, today: isoDate.optional() }).strict().parse(payload)
    return simpleMoney.moneyList(requireCompany().db, from, to, today ?? todayISO())
  }, 'viewer')
  handle('simple:money:entry', (payload) => {
    const { id } = z.object({ id: z.number().int().positive() }).strict().parse(payload)
    return simpleMoney.moneyEntry(requireCompany().db, id)
  }, 'viewer')
  // WP 9.2: the simple Sell screens' reads (services/simpleSell.ts) — the form's customers, cash /
  // bank accounts and their defaults (WP 5.6 memory, else the counter's), the sales list with what
  // is still due on each bill (the Outstandings allocation as on today) and one bill's simple view.
  // Writing goes through simple:post only.
  handle('simple:sell:setup', () => simpleSell.sellSetup(requireCompany().db), 'viewer')
  handle('simple:sales', (payload) => {
    const { from, to, today } = z.object({ from: isoDate, to: isoDate, today: isoDate.optional() }).strict().parse(payload)
    return simpleSell.salesList(requireCompany().db, from, to, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:sale', (payload) => {
    const { id, today } = z.object({ id: z.number().int().positive(), today: isoDate.optional() }).strict().parse(payload)
    return simpleSell.saleView(requireCompany().db, id, homeAsOn(today, todayISO()))
  }, 'viewer')
  // WP 9.7: the simple Stock screens' reads (services/simpleStock.ts) — the product list (the
  // Stock summary's own valuation pass as on today), one product's view and history, and Made
  // goods' recipes. Counting and making go through simple:post; "Change price" writes the
  // product's row on the default price level (priceLevels.saveRate, audited).
  handle('simple:stock:list', (payload) => {
    const { today } = z.object({ today: isoDate.optional() }).strict().optional().parse(payload) ?? {}
    return simpleStock.stockList(requireCompany().db, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:stock:product', (payload) => {
    const { id, today } = z.object({ id: z.number().int().positive(), today: isoDate.optional() }).strict().parse(payload)
    return simpleStock.stockProduct(requireCompany().db, id, homeAsOn(today, todayISO()))
  }, 'viewer')
  // A saved stock count reopened, with the difference the valuation engine recorded.
  handle('simple:stock:count', (payload) => {
    const { voucherId } = z.object({ voucherId: z.number().int().positive() }).strict().parse(payload)
    return simpleStock.savedCount(requireCompany().db, voucherId)
  }, 'viewer')
  handle('simple:stock:madeSetup', (payload) => {
    const { date } = z.object({ date: isoDate }).strict().parse(payload)
    return simpleStock.madeGoodsSetup(requireCompany().db, date)
  }, 'viewer')
  handle('simple:stock:setPrice', (payload) => {
    const { itemId, ratePaise, date } = z.object({ itemId: z.number().int().positive(), ratePaise: z.number().int().positive().max(1e13), date: isoDate.optional() }).strict().parse(payload)
    return simpleStock.setSellingPrice(requireCompany().db, itemId, ratePaise, date ?? todayISO())
  })
  // The simple recipe editor: a NEW BOM version through bom.saveBomVersion (the full editor's
  // save and audit row; accountant+, as bom:saveVersion), the labour per unit beside it.
  handle('simple:stock:setRecipe', (payload) => {
    const q = z
      .object({
        itemId: z.number().int().positive(),
        rows: z.array(z.object({ itemId: z.number().int().positive(), qtyMilli: z.number().int().min(0).max(1e12) }).strict()).max(200),
        labourPerUnit: z.number().int().min(0).max(1e13).nullable().optional(),
        date: isoDate.optional()
      })
      .strict()
      .parse(payload)
    return simpleStock.saveRecipe(requireCompany().db, { itemId: q.itemId, rows: q.rows, labourPerUnit: q.labourPerUnit ?? null }, q.date ?? todayISO())
  })

  // WP 9.9: the simple Reports screens (services/simpleReports.ts) — read-only, as on today (a
  // later date asked for is clamped): how the business is doing for a period (the P&L's own
  // totals), cash in the next 30 days (the Cash forecast), who owes whom (Outstandings) and the
  // registers by month.
  handle('simple:reports:doing', (payload) => {
    const q = doingQuerySchema.parse(payload)
    return simpleReports.businessDoing(requireCompany().db, q, homeAsOn(q.today, todayISO()))
  }, 'viewer')
  handle('simple:reports:cash', (payload) => {
    const { today } = z.object({ today: isoDate.optional() }).strict().optional().parse(payload) ?? {}
    const c = requireCompany()
    return simpleReports.cashNext30(c.db, c.info, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:reports:owed', (payload) => {
    const { side, today } = owedQuerySchema.parse(payload)
    return simpleReports.owedList(requireCompany().db, side, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:reports:byMonth', (payload) => {
    const { today } = z.object({ today: isoDate.optional() }).strict().optional().parse(payload) ?? {}
    return simpleReports.byMonth(requireCompany().db, homeAsOn(today, todayISO()))
  }, 'viewer')
  // WP 9.9: the simple Taxes screen (services/simpleTaxes.ts) — the GST answer for a period (the
  // Home tile's by default) over gstr3b() / GSTR-2B / the close checklist, TDS / TCS when on;
  // and "I've filed" (meta gstFiled: ARN + date per return, audited as a company update).
  handle('simple:taxes', (payload) => {
    const { period, today } = taxesQuerySchema.parse(payload ?? {})
    const c = requireCompany()
    return simpleTaxes.simpleTaxes(c.db, c.info, { period }, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:taxes:filed', (payload) => {
    const input = gstFiledInputSchema.parse(payload)
    const c = requireCompany()
    return simpleTaxes.setGstFiled(c.db, c.info, input, sessionUser()?.name ?? null, todayISO())
  })

  // WP 9.8: the simple People screens (services/simplePeople.ts) — every figure as on today from
  // the Outstandings allocation (the Outstandings screen's and Home's). Phone / WhatsApp / credit
  // days go through masters.updateLedger (the full app's account write, accountant+); a reminder
  // sent from a person's page is logged in reminder_log like the WP 4.2 letter (accountant+).
  handle('simple:people:list', (payload) => {
    const { today } = peopleListSchema.parse(payload ?? {})
    return simplePeople.peopleList(requireCompany().db, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:people:person', (payload) => {
    const { id, today } = personViewSchema.parse(payload)
    const c = requireCompany()
    return simplePeople.personView(c.db, c.info, id, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:people:billsToPay', (payload) => {
    const { today } = peopleListSchema.parse(payload ?? {})
    return simplePeople.billsToPay(requireCompany().db, homeAsOn(today, todayISO()))
  }, 'viewer')
  handle('simple:people:update', (payload) => simplePeople.updatePerson(requireCompany().db, personUpdateSchema.parse(payload)))
  handle('simple:people:reminded', (payload) => {
    const { id, via, tone, today } = personRemindedSchema.parse(payload)
    return simplePeople.personReminded(requireCompany().db, id, via, homeAsOn(today, todayISO()), tone)
  })

  // WP 9.5: the simple return screens' reads (services/simpleReturns.ts) — the recent bills with
  // what is still returnable, and one bill as simple:post maps a return from it (as on the
  // return's date, never past today). Writing goes through simple:post only.
  const returnSide = z.enum(['sale', 'purchase'])
  handle('simple:returns:bills', (payload) => {
    const { side, today, q, all } = z.object({ side: returnSide, today: isoDate.optional(), q: z.string().max(80).optional(), all: z.boolean().optional() }).strict().parse(payload)
    const c = requireCompany()
    return simpleReturns.returnBills(c.db, c.info, side, homeAsOn(today, todayISO()), q, { all })
  }, 'viewer')
  handle('simple:returns:bill', (payload) => {
    const { side, id, asOn } = z.object({ side: returnSide, id: z.number().int().positive(), asOn: isoDate.optional() }).strict().parse(payload)
    const c = requireCompany()
    return simpleReturns.returnBill(c.db, c.info, side, id, homeAsOn(asOn, todayISO()))
  }, 'viewer')
  // WP 9.6: the simple Bank screen (services/simpleBank.ts). Reads: the bank accounts and every
  // account's class; one bank's statement lines with the matcher's / categoriser's suggestion
  // (no model — the screen asks bankImport:categorise for that, only when AI is ready) and the
  // BRS sentence's facts. The write: each accepted line in its own transaction — confirming the
  // matcher's proposal, or a WP 9.1 intent through simple:post's service whose line is then
  // reconciled by bankImport.reconcileSavedDraft. The statement itself comes in through the
  // existing bankImport:pickFile / preview / commit channels.
  handle('simple:bank:setup', () => simpleBank.bankSetup(requireCompany().db), 'viewer')
  handle('simple:bank:lines', (payload) => {
    const { bankLedgerId, today, lang } = z
      .object({ bankLedgerId: z.number().int().positive(), today: isoDate.optional(), lang: z.enum(LANGUAGES).optional() })
      .strict()
      .parse(payload)
    return simpleBank.bankView(requireCompany().db, bankLedgerId, homeAsOn(today, todayISO()), lang)
  }, 'viewer')
  handle('simple:bank:accept', (payload) => {
    const { bankLedgerId, items, today } = bankAcceptSchema.extend({ today: isoDate.optional() }).strict().parse(payload)
    const c = requireCompany()
    const out = simpleBank.acceptLines(c.db, c.info, bankLedgerId, items, today ?? todayISO())
    if (out.done.length && configSvc.getAgentBridgeEnabled(c.db)) agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: canSeeProfitNow() })
    return out
  })
  return { postSimpleIntent }
}
