// Phase 3b: ONE approval queue for everything the assistants propose — chat drafts, captured
// bills, bank-line categories, GSTR-2B fixes, Ask Total offers and memory suggestions. The queue
// is a READ over the rows that already hold them (ai_drafts, capture_items, ai_memory); nothing
// is stored for it. Approving goes through the save path a person uses (voucher:save's save /
// simple:post's postIntent) — see main/ai/queue.ts.
import type { AssistPrefill } from './assist'

/** Where a proposal came from (plain words in simple mode: simple.queue.from.*). */
export type QueueOrigin = 'chat' | 'capture' | 'bank' | 'gst2b' | 'askTotal' | 'memory' | 'other'

/** What it would record (simple.queue.what.*). */
export type QueueWhat =
  | 'sale' | 'purchase' | 'money_in' | 'money_out' | 'move_money' | 'return_sale' | 'return_purchase'
  | 'journal' | 'stock' | 'order' | 'made' | 'bill_to_read' | 'memory'

/** How Approve saves it, or why it can only be edited / opened:
 *  - voucher: the draft's form state → the editor's payload → voucher:save's save (draft consumed);
 *  - simple: an Ask Total offer's intent → simple:post (draft consumed);
 *  - memory: an assistant memory suggestion → active (ai:memory:setStatus);
 *  - edit: no one-click save (a manufacture / order / challan draft, a WP 5.1 draft without a form,
 *    an Ask Total offer the flow still asks something for) — Edit opens it;
 *  - manual_number: the voucher type is numbered by hand — Edit to type the number;
 *  - capture: a bill still being read / waiting for answers — opens the Capture screen;
 *  - changed: today's masters give other figures than the draft showed (a rate / account changed)
 *    — Edit to see them (the queue lists the lines Approve would post today);
 *  - check: a captured bill the reader flagged (possible duplicate, printed GST / total differs,
 *    low confidence, unread parts, a number the duplicate check can't compare) — Edit to check it;
 *  - line_done: a bank-line draft whose statement line was matched or left out meanwhile —
 *    nothing to record (Discard);
 *  - tds: the existing TDS rules say this payment / purchase needs TDS — Edit (the editor's TDS box;
 *    owner, 8 Nov). */
export type QueueApprove = 'voucher' | 'simple' | 'memory' | 'edit' | 'manual_number' | 'capture' | 'changed' | 'check' | 'line_done' | 'tds'

export interface QueueLine {
  ledgerId: number
  ledgerName: string
  drCr: 'dr' | 'cr'
  amount: number
}

export interface QueueProposal {
  /** Stable key: 'draft:<id>' | 'capture:<id>' | 'memory:<id>'. */
  key: string
  type: 'draft' | 'capture' | 'memory'
  id: number
  origin: QueueOrigin
  what: QueueWhat
  /** Proposals made together (one chat answer's drafts) share a group; null = on its own. */
  group: string | null
  voucherKind: string | null
  date: string | null
  partyName: string | null
  /** Paise (the document total / amount); null when there is none (memory, a bill not read yet). */
  amount: number | null
  /** The proposer's own sentence (English — the accountant view; simple mode words it with t()). */
  summary: string
  /** The ledger lines the save would post (accountant view, Dr / Cr). */
  lines: QueueLine[]
  assumptions: string[]
  /** Made when nobody asked for it (possible injected instruction) — never part of "Approve all". */
  unrequested: boolean
  approve: QueueApprove
  createdAt: string
  /** draft: the ai_drafts row (Edit opens it); capture: its file name; memory: its text. */
  draftForm?: string | null
  /** Simple mode's Edit: the simple flow the draft opens in (an Ask Total offer's own prefill, or
   *  a chat draft's — shared/simple/aiPlain draftOffer); absent = the full editor. */
  prefill?: AssistPrefill
  fileName?: string
  captureStatus?: string
  memoryText?: string
}

export interface QueueList {
  proposals: QueueProposal[]
  /** Proposals Approve can save in one click (the count Home / the panel show). */
  waiting: number
}

/** Result of approving one proposal. */
export interface QueueApproveResult {
  key: string
  voucherIds: number[]
  memoryId?: number
}

const KIND_WHAT: Record<string, QueueWhat> = {
  sales: 'sale', purchase: 'purchase', receipt: 'money_in', payment: 'money_out', contra: 'move_money',
  credit_note: 'return_sale', debit_note: 'return_purchase', journal: 'journal',
  delivery_note: 'stock', receipt_note: 'stock', stock_journal: 'stock', physical_stock: 'stock',
  manufacture: 'made', quotation: 'order', sales_order: 'order', purchase_order: 'order'
}

export function whatOfKind(kind: string | null | undefined): QueueWhat {
  return (kind && KIND_WHAT[kind]) || 'journal'
}

/** One click saves it (Approve shown). */
export const oneClick = (p: Pick<QueueProposal, 'approve'>): boolean => p.approve === 'voucher' || p.approve === 'simple' || p.approve === 'memory'

/** Proposals "Approve all" takes: one-click saves somebody asked for — never a captured bill (each
 *  one is approved after a look at its file). */
export function approvableTogether(p: Pick<QueueProposal, 'approve' | 'unrequested' | 'origin'>): boolean {
  return oneClick(p) && !p.unrequested && p.origin !== 'capture'
}

/** Groups in queue order: proposals with the same `group` together (first one's place), the rest one each. */
export function groupProposals<T extends Pick<QueueProposal, 'group' | 'key'>>(list: readonly T[]): { group: string | null; items: T[] }[] {
  const out: { group: string | null; items: T[] }[] = []
  const byGroup = new Map<string, { group: string | null; items: T[] }>()
  for (const p of list) {
    if (p.group) {
      const g = byGroup.get(p.group)
      if (g) {
        g.items.push(p)
        continue
      }
      const n = { group: p.group, items: [p] }
      byGroup.set(p.group, n)
      out.push(n)
    } else out.push({ group: null, items: [p] })
  }
  return out
}
