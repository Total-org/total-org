// Phase 3b — the approval queue (shapes in @shared/aiQueue). A READ over the rows that already
// hold the assistants' proposals:
//   - ai_drafts (status open): chat drafts, captured bills (source capture), bank-line categories
//     (capture + payload.bankLine), GSTR-2B fixes (source assistant), Ask Total offers
//     (payload.origin 'ask-total');
//   - capture_items still being read or waiting for answers (no open draft);
//   - ai_memory rows the assistant suggested.
// Approving never adds a posting path: a draft's stored editor form state is turned into the
// payload with the editor's own shared mapping (drafting/builders invoiceSavePayload /
// accountingSavePayload — the functions the WP 5.3 rehearsal uses) INSIDE voucher:save's own save
// (ipc.ts saveVoucherRequest), which consumes the draft in the same transaction; an Ask Total
// offer posts through simple:post's postIntent. Approve posts only what the queue showed: the
// figures are rebuilt from today's masters and compared with the draft's (`queue_changed`
// otherwise); a captured bill the reader flagged, or a bank line dealt with elsewhere, is never
// one-click.
import type { DB } from '../db/connection'
import type { CompanyInfo, VoucherKind, VoucherType } from '@shared/domain'
import type { AiDraftDto } from '@shared/ai'
import type { QueueApprove, QueueLine, QueueList, QueueOrigin, QueueProposal } from '@shared/aiQueue'
import { whatOfKind } from '@shared/aiQueue'
import type { AccountingFormState, InvoiceFormState } from '@shared/voucherEdit'
import type { CaptureReview } from '@shared/capture/types'
import { findDuplicates, invoiceNoComparable } from '@shared/capture/duplicates'
import { voucherInputSchema, type VoucherInputParsed } from '@shared/schemas'
import { AppError } from '@shared/errors/appError'
import { draftOffer } from '@shared/simple/aiPlain'
import type { AssistPrefill } from '@shared/assist'
import { nextVoucherNumber, saveVoucher } from '../services/vouchers'
import { getFeatures } from '../services/config'
import { tdsEligible } from '../services/tdsWorkbench'
import { previewIntent } from '../services/simplePost'
import { listVoucherTypes, partyGroupIdsBySide } from '../services/masters'
import { statementLineOpen } from '../services/bankImport'
import { getDraft, listDrafts } from './store'
import { listMemory } from './memory'
import { loadMasters, type DraftMasters } from './drafting/work'
import { accountingSavePayload, invoiceSavePayload } from './drafting/builders'
import { rehearse } from './drafting/rehearse'
import { duplicateCandidates } from './capture/billDraft'
import { queuePlans } from '../services/aiPlans'
import { lateReminders } from '../services/simplePeople'
import { chargesGstOn } from '@shared/gst/registration'

const ONE_CLICK_FORMS = new Set(['accounting', 'invoice'])

function originOf(d: AiDraftDto): QueueOrigin {
  if (d.payload.origin === 'ask-total') return 'askTotal'
  if (d.source === 'chat') return 'chat'
  if (d.source === 'capture') return d.payload.bankLine ? 'bank' : 'capture'
  if (d.source === 'assistant') return 'gst2b'
  return 'other'
}

interface CaptureFacts {
  id: number
  duplicateKind: string | null
  supplierLedgerId: number | null
  invoiceNo: string | null
  invoiceDate: string | null
  total: number | null
  review: CaptureReview | null
}

function captureFacts(db: DB, id: number): CaptureFacts | null {
  const r = db
    .prepare('SELECT id, duplicate_kind, supplier_ledger_id, invoice_no, invoice_date, total, review_json FROM capture_items WHERE id = ?')
    .get(id) as { id: number; duplicate_kind: string | null; supplier_ledger_id: number | null; invoice_no: string | null; invoice_date: string | null; total: number | null; review_json: string | null } | undefined
  if (!r) return null
  let review: CaptureReview | null = null
  try {
    review = r.review_json ? (JSON.parse(r.review_json) as CaptureReview) : null
  } catch {
    review = null
  }
  return { id: r.id, duplicateKind: r.duplicate_kind, supplierLedgerId: r.supplier_ledger_id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, total: r.total, review }
}

/** A captured bill the reader flagged — a possible duplicate, a printed GST / total that differs
 *  from the editor's, a low-confidence or partly unread bill, a number the duplicate check could
 *  not compare — is opened and checked, never saved in one click (review of #221). */
export function captureNeedsCheck(c: CaptureFacts | null, company: CompanyInfo, date: string): boolean {
  if (!c || !c.review) return true
  const r = c.review
  const t = r.taxCheck
  // As the bill reader words it: a GST difference counts only on a GST-charging date (a company
  // that can't claim GST folds the bill's GST into the cost — there is no tax line to compare).
  const gstDiffers = t != null && t.computed !== t.printed && chargesGstOn(company, date)
  return (
    c.duplicateKind != null ||
    (r.duplicates ?? []).length > 0 ||
    gstDiffers ||
    (t != null && t.printedTotal != null && t.printedTotal !== t.computedTotal) ||
    r.parsed?.confidence === 'low' ||
    (r.parsed?.warnings ?? []).length > 0 ||
    (r.totals?.discrepancies ?? []).length > 0 ||
    !invoiceNoComparable(r.parsed?.invoiceNo ?? null)
  )
}

/** How Approve saves a draft, before its figures are rebuilt (`types` = the voucher types by id). */
function approveOf(db: DB, company: CompanyInfo, d: AiDraftDto, types: ReadonlyMap<number, VoucherType>): QueueApprove {
  if (d.payload.simple) return d.payload.simple.intent ? 'simple' : 'edit'
  if (!d.payload.state || !ONE_CLICK_FORMS.has(d.payload.form ?? 'accounting')) return 'edit'
  const t = types.get(d.payload.voucherTypeId)
  if (!t) return 'edit'
  if (t.numbering === 'manual') return 'manual_number'
  if (d.payload.bankLine && statementLineOpen(db, d.payload.bankLine.bankLedgerId, d.payload.bankLine.statementLineId)) return 'line_done'
  if (d.source === 'capture' && !d.payload.bankLine && d.payload.captureItemId && captureNeedsCheck(captureFacts(db, d.payload.captureItemId), company, d.payload.date)) return 'check'
  return 'voucher'
}

/** The simple flow a draft's Edit opens in simple mode: an Ask Total offer's own prefill, a chat
 *  draft's flow (WP 10.6 draftOffer — the flow's first save consumes it). Captured bills and bank
 *  lines open their full editor (their save attaches the file / reconciles the line). */
function simplePrefill(d: AiDraftDto): AssistPrefill | null {
  if (d.payload.simple) return d.payload.simple.prefill
  if (d.source === 'chat') return draftOffer(d).prefill
  return null
}

/** Who a payment / receipt without a party went to / came from: its one expense / income side
 *  (the Dr line of a payment, the Cr line of a receipt) — so "Money out to Shop Rent". */
function counterparty(kind: string, lines: readonly QueueLine[]): string | null {
  const side = kind === 'payment' ? 'dr' : kind === 'receipt' ? 'cr' : null
  const on = side ? lines.filter((l) => l.drCr === side) : []
  return on.length === 1 ? on[0]!.ledgerName : null
}

/** The payload the draft's editor would save today, built with the editor's shared mapping. Called
 *  INSIDE a transaction (the save's, or a rehearsal): like the editor on first use, it creates a
 *  missing GST / Round Off ledger (audited by createLedger); the number is the series' next one
 *  (what the editor suggests; saveVoucher would pick the same), and the advance the builder marked
 *  (`payload.advanceRef`, named after the number of the draft's day) is named after it, as the
 *  accounting form names it. */
export function draftVoucherPayload(m: DraftMasters, d: AiDraftDto, type: VoucherType): VoucherInputParsed {
  const p = d.payload
  const number = nextVoucherNumber(m.db, type.id, (p.state as { date: string }).date)
  if (p.form === 'invoice') return voucherInputSchema.parse(invoiceSavePayload(m, p.voucherKind as VoucherKind, type.id, p.state as InvoiceFormState, number))
  const state = p.state as AccountingFormState
  // Only the ref the builder marked as the advance follows the number (review of #221: a captured
  // bill's `new` ref carries the supplier's invoice number and keeps it, as the editor's save does).
  const billRefs = p.advanceRef ? state.billRefs.map((r) => (r.kind === 'new' && r.name === p.advanceRef ? { ...r, name: number } : r)) : state.billRefs
  return voucherInputSchema.parse(accountingSavePayload(m, type, { ...state, number, billRefs }))
}

/** True when the rebuilt payload posts what the draft showed: the same amount on every ledger the
 *  draft listed and the same document total on the party (a GST / Round Off ledger created on
 *  first use was not listed — it had no id yet). */
export function postsAsDrafted(d: AiDraftDto, built: VoucherInputParsed): boolean {
  const key = (ledgerId: number, drCr: string): string => `${ledgerId}:${drCr}`
  const sum = (lines: readonly { ledgerId: number; drCr: string; amount: number }[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const l of lines) m.set(key(l.ledgerId, l.drCr), (m.get(key(l.ledgerId, l.drCr)) ?? 0) + l.amount)
    return m
  }
  const was = sum(d.payload.lines ?? [])
  const now = sum(built.lines)
  for (const [k, v] of was) if (now.get(k) !== v) return false
  if (d.payload.form !== 'invoice') {
    for (const k of now.keys()) if (!was.has(k)) return false
    return true
  }
  const party = d.payload.partyLedgerId
  if (party == null || d.payload.total == null) return true
  const partyNow = built.lines.filter((l) => l.ledgerId === party).reduce((s, l) => s + (l.drCr === 'dr' ? l.amount : -l.amount), 0)
  return Math.abs(partyNow) === d.payload.total
}

/** Owner (8 Nov): a proposal the EXISTING TDS rules (tdsWorkbench.tdsEligible) say needs TDS is
 *  opened in the editor (where the TDS box is), never saved in one click without it. Called inside
 *  a rehearsal or the save's transaction — the payload is saved in a nested rehearsal to ask. */
function needsTds(db: DB, built: VoucherInputParsed, kind: string): boolean {
  if ((kind !== 'payment' && kind !== 'purchase') || !getFeatures(db).tds) return false
  // Cheap pre-check (review of #221, R2): a TDS event needs a section — from a ledger of the entry
  // (its own or default section) or, for a supplier, from its earlier bills (tdsEvents
  // `sectionFrom: 'credits'`). An entry with neither (Dr Rent / Cr Cash) skips the FY-wide pass.
  const ids = [...new Set(built.lines.map((l) => l.ledgerId))]
  if (!ids.length) return false
  const creditors = partyGroupIdsBySide(db, 'creditor')
  const rows = db
    .prepare(`SELECT group_id AS groupId, tds_section_id AS s, tds_default_section_id AS d FROM ledgers WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids) as { groupId: number; s: number | null; d: number | null }[]
  if (!rows.some((r) => r.s != null || r.d != null || creditors.has(r.groupId))) return false
  return rehearse(db, () => {
    const v = saveVoucher(db, built)
    return tdsEligible(db, built.date, built.date).some((r) => r.voucherId === v.id)
  })
}

/** The same question for an Ask Total offer: simple:preview's TDS hint (the same rules). */
function offerNeedsTds(db: DB, company: CompanyInfo, d: AiDraftDto, today: string): boolean {
  const intent = d.payload.simple?.intent as { kind?: string } | null
  if (!intent || (intent.kind !== 'money_out' && intent.kind !== 'purchase') || !getFeatures(db).tds) return false
  try {
    return !!previewIntent(db, company, { ...intent, clientId: `queue-tds-check-${d.id}` }, today).tds?.length
  } catch {
    return false // a refused offer is refused again, with its own reason, when it is approved
  }
}

const linesWithNames = (db: DB, lines: readonly { ledgerId: number; drCr: 'dr' | 'cr'; amount: number }[]): QueueLine[] => {
  const name = db.prepare('SELECT name FROM ledgers WHERE id = ?')
  return lines.map((l) => ({ ledgerId: l.ledgerId, drCr: l.drCr, amount: l.amount, ledgerName: (name.get(l.ledgerId) as { name: string } | undefined)?.name ?? `#${l.ledgerId}` }))
}

/** The open proposals, newest first (a chat answer's drafts stay together, in the order made).
 *  A one-click draft shows the lines Approve would post TODAY (rehearsed, rolled back). */
export function listQueue(db: DB, company: CompanyInfo, today: string): QueueList {
  const names = new Map((db.prepare('SELECT id, name FROM ledgers').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]))
  const types = new Map(listVoucherTypes(db).map((t) => [t.id, t]))
  const drafts = listDrafts(db, 'open')
  const planned = queuePlans(db)
  const perMessage = new Map<number, number>()
  for (const d of drafts) if (d.messageId) perMessage.set(d.messageId, (perMessage.get(d.messageId) ?? 0) + 1)
  let masters: DraftMasters | null = null
  const out: QueueProposal[] = []
  for (const d of drafts) {
    const p = d.payload
    let lines: QueueLine[] = (p.lines ?? []).map((l) => ({ ...l, ledgerName: names.get(l.ledgerId) ?? `#${l.ledgerId}` }))
    let approve = approveOf(db, company, d, types)
    if (approve === 'voucher') {
      masters ??= loadMasters(db, company, today)
      const m = masters
      try {
        const now = rehearse(db, () => {
          const built = draftVoucherPayload(m, d, types.get(p.voucherTypeId)!)
          return { lines: linesWithNames(db, built.lines), same: postsAsDrafted(d, built), tds: needsTds(db, built, p.voucherKind) }
        })
        lines = now.lines
        if (!now.same) approve = 'changed'
        else if (now.tds) approve = 'tds'
      } catch {
        approve = 'edit'
      }
    }
    if (approve === 'simple' && offerNeedsTds(db, company, d, today)) approve = 'tds'
    const amount = p.total ?? (lines.length ? lines.filter((l) => l.drCr === 'dr').reduce((s, l) => s + l.amount, 0) : null)
    out.push({
      key: `draft:${d.id}`, type: 'draft', id: d.id, origin: originOf(d), what: whatOfKind(p.voucherKind),
      group: planned.draftPlan.has(d.id) ? `plan:${planned.draftPlan.get(d.id)}` : d.messageId && (perMessage.get(d.messageId) ?? 0) > 1 ? `message:${d.messageId}` : null,
      voucherKind: p.voucherKind ?? null, date: p.date ?? null,
      partyName: (p.partyLedgerId ? names.get(p.partyLedgerId) : null) ?? counterparty(p.voucherKind, lines),
      amount, summary: d.summary, lines, assumptions: p.assumptions ?? [], unrequested: d.unrequested,
      approve, createdAt: d.createdAt, draftForm: p.form ?? 'accounting',
      ...(simplePrefill(d) ? { prefill: simplePrefill(d)! } : {})
    })
  }
  // A plan's reminders: the People page's reminder facts as on today (one Outstandings run).
  if (planned.reminders.length) {
    const late = new Map(lateReminders(db, today, 1, new Set(planned.reminders.map((r) => r.partyId))).map((r) => [r.ledgerId, r]))
    const sourceOf = new Map(planned.plans.map((p) => [p.id, p.source === 'ask-total' ? ('askTotal' as const) : ('chat' as const)]))
    for (const r of planned.reminders) {
      const l = late.get(r.partyId)
      out.push({
        key: `reminder:${r.itemId}`, type: 'reminder', id: r.itemId, origin: sourceOf.get(r.planId) ?? 'other', what: 'reminder', group: `plan:${r.planId}`, voucherKind: null,
        date: null, partyName: l?.name ?? names.get(r.partyId) ?? null, amount: l?.reminder.amount ?? null,
        summary: l ? `Remind ${l.name} about ${l.reminder.bills.length} late bill(s)` : `${names.get(r.partyId) ?? ''}: nothing late any more`,
        lines: [], assumptions: [], unrequested: false, approve: l ? 'reminder' : 'nothing_late', createdAt: r.createdAt,
        reminder: { partyId: r.partyId, phone: l?.phone ?? null, whatsapp: l?.whatsapp ?? null, facts: l?.reminder ?? null }
      })
    }
  }
  // Bills still being read, or waiting for the user's answers / the cost approval.
  const captures = db
    .prepare(`SELECT id, file_name, status, supplier_name, invoice_date, total, created_at FROM capture_items
              WHERE status IN ('queued', 'pending', 'processing', 'needs_review', 'failed')
                AND (draft_id IS NULL OR draft_id NOT IN (SELECT id FROM ai_drafts WHERE status = 'open'))
              ORDER BY id DESC`)
    .all() as { id: number; file_name: string; status: string; supplier_name: string | null; invoice_date: string | null; total: number | null; created_at: string }[]
  for (const c of captures) {
    out.push({
      key: `capture:${c.id}`, type: 'capture', id: c.id, origin: 'capture', what: 'bill_to_read', group: null, voucherKind: null,
      date: c.invoice_date, partyName: c.supplier_name, amount: c.total, summary: c.file_name, lines: [], assumptions: [],
      unrequested: false, approve: 'capture', createdAt: c.created_at, fileName: c.file_name, captureStatus: c.status
    })
  }
  for (const m of listMemory(db, 'suggested')) {
    out.push({
      key: `memory:${m.id}`, type: 'memory', id: m.id, origin: 'memory', what: 'memory', group: null, voucherKind: null, date: null,
      partyName: m.labels.party ?? null, amount: null, summary: m.text, lines: [], assumptions: [], unrequested: m.unrequested,
      approve: 'memory', createdAt: m.createdAt, memoryText: m.text
    })
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return { proposals: out, plans: planned.plans, waiting: out.filter((p) => p.approve === 'voucher' || p.approve === 'simple' || p.approve === 'memory' || p.approve === 'reminder').length }
}

const REFUSAL: Partial<Record<QueueApprove, () => AppError>> = {
  tds: () => new AppError('queue_tds', 'This payment needs TDS deducted — open it to fill in the TDS'),
  changed: () => new AppError('queue_changed', 'The figures changed since this was prepared (a rate or account changed) — open it to check'),
  manual_number: () => new AppError('queue_manual_number', 'This voucher type is numbered by hand — open it to type the number'),
  line_done: () => new AppError('queue_line_done', 'This bank line was already matched or left out — nothing to record'),
  check: () => new AppError('queue_check', 'The bill reader flagged this bill — open it and check it before saving')
}

/** An open draft Approve may save in one click, or the reason it can't. */
export function openDraftFor(db: DB, company: CompanyInfo, draftId: number, path: 'voucher' | 'simple'): AiDraftDto {
  const d = getDraft(db, draftId)
  if (!d) throw new AppError('queue_not_found', 'This proposal is no longer there')
  if (d.status !== 'open') throw new AppError('queue_not_open', `This proposal is already ${d.status}`, { params: { status: d.status } })
  const how = approveOf(db, company, d, new Map(listVoucherTypes(db).map((t) => [t.id, t])))
  const refusal = REFUSAL[how]
  if (refusal) throw refusal()
  if (how !== path) throw new AppError('queue_edit_only', 'This proposal cannot be saved in one click — open it to finish it')
  return d
}

/** An Ask Total offer Approve may post (path 'simple'): open, one-click, and not one that needs TDS. */
export function openOfferFor(db: DB, company: CompanyInfo, draftId: number, today: string): AiDraftDto {
  const d = openDraftFor(db, company, draftId, 'simple')
  if (offerNeedsTds(db, company, d, today)) throw REFUSAL.tds!()
  return d
}

/** Approve's payload for a draft (path 'voucher'), built inside voucher:save's transaction: the
 *  draft is open and one-click, today's figures are those the draft showed, and — for a captured
 *  bill — no voucher of the same supplier carries its invoice number in its FY by now. */
export function approvalPayload(db: DB, company: CompanyInfo, draftId: number, today: string): VoucherInputParsed {
  const d = openDraftFor(db, company, draftId, 'voucher')
  const type = listVoucherTypes(db).find((t) => t.id === d.payload.voucherTypeId)!
  const built = draftVoucherPayload(loadMasters(db, company, today), d, type)
  if (!postsAsDrafted(d, built)) throw REFUSAL.changed!()
  if (needsTds(db, built, d.payload.voucherKind)) throw REFUSAL.tds!()
  const c = d.source === 'capture' && d.payload.captureItemId ? captureFacts(db, d.payload.captureItemId) : null
  if (c?.supplierLedgerId) {
    const dup = findDuplicates(
      { partyLedgerId: c.supplierLedgerId, invoiceNo: c.invoiceNo, date: c.invoiceDate, total: c.total, today },
      duplicateCandidates(db, [c.supplierLedgerId], c.id)
    ).find((h) => h.kind === 'same_invoice')
    if (dup) throw new AppError('queue_duplicate', `${dup.why} — open it to check`)
  }
  return built
}
