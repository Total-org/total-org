// Phase 3b — the approval queue (shapes in @shared/aiQueue). A READ over the rows that already
// hold the assistants' proposals:
//   - ai_drafts (status open): chat drafts, captured bills (source capture), bank-line categories
//     (capture + payload.bankLine), GSTR-2B fixes (source assistant), Ask Total offers
//     (payload.origin 'ask-total');
//   - capture_items still being read or waiting for answers (no draft yet);
//   - ai_memory rows the assistant suggested.
// Approving never adds a posting path: a draft's stored editor form state is turned into the
// payload with the editor's own shared mapping (voucherEdit — the same functions the WP 5.3
// rehearsal used) and saved by the caller through voucher:save's save (ipc.ts), which consumes the
// draft in the same transaction; an Ask Total offer posts through simple:post's postIntent.
import type { DB } from '../db/connection'
import type { CompanyInfo, VoucherKind } from '@shared/domain'
import type { AiDraftDto } from '@shared/ai'
import type { QueueApprove, QueueLine, QueueList, QueueOrigin, QueueProposal } from '@shared/aiQueue'
import { whatOfKind } from '@shared/aiQueue'
import type { AccountingFormState, InvoiceFormState } from '@shared/voucherEdit'
import { buildAccountingPayload, buildInvoicePayload, computeInvoice, derivePartyId, requiredTaxLedgers, taxLedgerIdsFrom, taxSideOf } from '@shared/voucherEdit'
import { voucherInputSchema, type VoucherInputParsed } from '@shared/schemas'
import { nextVoucherNumber } from '../services/vouchers'
import { listVoucherTypes } from '../services/masters'
import { getDraft, listDrafts } from './store'
import { listMemory } from './memory'
import { loadMasters, isParty } from './drafting/work'
import { ensureTaxLedgers, invoiceCtx } from './drafting/builders'
import { AppError } from '@shared/errors/appError'
import { draftOffer } from '@shared/simple/aiPlain'
import type { AssistPrefill } from '@shared/assist'

const ONE_CLICK_FORMS = new Set(['accounting', 'invoice'])

function originOf(d: AiDraftDto): QueueOrigin {
  if (d.payload.origin === 'ask-total') return 'askTotal'
  if (d.source === 'chat') return 'chat'
  if (d.source === 'capture') return d.payload.bankLine ? 'bank' : 'capture'
  if (d.source === 'assistant') return 'gst2b'
  return 'other'
}

function approveOf(db: DB, d: AiDraftDto): QueueApprove {
  if (d.payload.simple) return d.payload.simple.intent ? 'simple' : 'edit'
  if (!d.payload.state || !ONE_CLICK_FORMS.has(d.payload.form ?? 'accounting')) return 'edit'
  const t = db.prepare('SELECT numbering FROM voucher_types WHERE id = ?').get(d.payload.voucherTypeId) as { numbering: string } | undefined
  if (!t) return 'edit'
  return t.numbering === 'manual' ? 'manual_number' : 'voucher'
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
function counterparty(kind: string, lines: QueueLine[]): string | null {
  const side = kind === 'payment' ? 'dr' : kind === 'receipt' ? 'cr' : null
  const on = side ? lines.filter((l) => l.drCr === side) : []
  return on.length === 1 ? on[0]!.ledgerName : null
}

/** The open proposals, newest first (a chat answer's drafts stay together, in the order made). */
export function listQueue(db: DB): QueueList {
  const names = new Map((db.prepare('SELECT id, name FROM ledgers').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]))
  const drafts = listDrafts(db, 'open')
  const perMessage = new Map<number, number>()
  for (const d of drafts) if (d.messageId) perMessage.set(d.messageId, (perMessage.get(d.messageId) ?? 0) + 1)
  const out: QueueProposal[] = []
  for (const d of drafts) {
    const p = d.payload
    const lines: QueueLine[] = (p.lines ?? []).map((l) => ({ ...l, ledgerName: names.get(l.ledgerId) ?? `#${l.ledgerId}` }))
    const amount = p.total ?? (lines.length ? lines.filter((l) => l.drCr === 'dr').reduce((s, l) => s + l.amount, 0) : null)
    out.push({
      key: `draft:${d.id}`, type: 'draft', id: d.id, origin: originOf(d), what: whatOfKind(p.voucherKind),
      group: d.messageId && (perMessage.get(d.messageId) ?? 0) > 1 ? `message:${d.messageId}` : null,
      voucherKind: p.voucherKind ?? null, date: p.date ?? null,
      partyName: (p.partyLedgerId ? names.get(p.partyLedgerId) : null) ?? counterparty(p.voucherKind, lines),
      amount, summary: d.summary, lines, assumptions: p.assumptions ?? [], unrequested: d.unrequested,
      approve: approveOf(db, d), createdAt: d.createdAt, draftForm: p.form ?? 'accounting',
      ...(simplePrefill(d) ? { prefill: simplePrefill(d)! } : {})
    })
  }
  // Bills still being read, or waiting for the user's answers / the cost approval.
  const captures = db
    .prepare(`SELECT id, file_name, status, supplier_name, invoice_date, total, created_at FROM capture_items
              WHERE status IN ('queued', 'needs_review', 'failed') AND (draft_id IS NULL OR draft_id NOT IN (SELECT id FROM ai_drafts WHERE status = 'open'))
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
  return { proposals: out, waiting: out.filter((p) => p.approve === 'voucher' || p.approve === 'simple' || p.approve === 'memory').length }
}

/** An open draft Approve may save in one click, or the reason it can't (AppError on `key`). */
export function openDraftFor(db: DB, draftId: number, path: 'voucher' | 'simple'): AiDraftDto {
  const d = getDraft(db, draftId)
  if (!d) throw new AppError('queue_not_found', 'This proposal is no longer there')
  if (d.status !== 'open') throw new AppError('queue_not_open', `This proposal is already ${d.status}`, { params: { status: d.status } })
  const how = approveOf(db, d)
  if (how === 'manual_number') throw new AppError('queue_manual_number', 'This voucher type is numbered by hand — open it to type the number')
  if (how !== path) throw new AppError('queue_edit_only', 'This proposal cannot be saved in one click — open it to finish it')
  return d
}

/** The payload the draft's editor would save, built with the editor's shared mapping. Called
 *  INSIDE the save's transaction: like the editor on first use, it creates a missing GST /
 *  Round Off ledger (audited by createLedger), and the number is the series' next one (what the
 *  editor suggests; saveVoucher would pick the same). */
export function draftVoucherPayload(db: DB, company: CompanyInfo, d: AiDraftDto, today: string): VoucherInputParsed {
  const p = d.payload
  const m = loadMasters(db, company, today)
  const kind = p.voucherKind as VoucherKind
  const type = listVoucherTypes(db).find((t) => t.id === p.voucherTypeId)
  if (!type) throw new AppError('queue_edit_only', 'The voucher type of this proposal no longer exists — open it to finish it')
  if (p.form === 'invoice') {
    const state = p.state as InvoiceFormState
    const ctx = invoiceCtx(m, kind)
    const computed = computeInvoice(state, ctx)
    const taxLedgers = ensureTaxLedgers(db, m, requiredTaxLedgers(computed), taxLedgerIdsFrom(m.ledgers, taxSideOf(kind)))
    const number = nextVoucherNumber(db, type.id, state.date)
    const built = buildInvoicePayload({ ...state, number, billName: state.billName || number }, ctx, type.id, taxLedgers)
    if (!built.ok) throw new Error(built.error)
    return voucherInputSchema.parse(built.payload)
  }
  const state = p.state as AccountingFormState
  const isPartyOrTds = (id: number): boolean => {
    const l = m.ledgers.find((x) => x.id === id)
    return !!l && (isParty(m, l) || l.tdsSectionId != null)
  }
  const derived = derivePartyId(state.rows, isPartyOrTds, null)
  const built = buildAccountingPayload({ ...state, number: nextVoucherNumber(db, type.id, state.date) }, { kind: type.kind, voucherTypeId: type.id, derivedPartyId: derived })
  if (!built.ok) throw new Error(built.error)
  return voucherInputSchema.parse(built.payload)
}
