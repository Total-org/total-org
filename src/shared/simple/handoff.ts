// WP 9.10 — the Accountant-view hand-off of an UNSAVED simple form (plan 2026-10-13 §0.1: "Every
// simple screen has an Accountant view that opens the full editor … with the same state").
//
// `simple:intentForm` maps the screen's current answers with the SAME pure mapping `simple:post`
// and `simple:preview` use (mapIntent over the IntentContext main loads), inside a rehearsal that
// is always rolled back, and returns the editors' own form state per entry. The renderer opens the
// first entry in its editor (the `initial` state the editors already take for AI drafts and
// alterations); the editor saves through voucher:save as always. Nothing here writes the books.
//
// A rehearsal may create what the editor itself creates on first use (the walk-in customer, a
// GST / round-off ledger, the labour accounts) — those rows are rolled back, so the state must not
// point at them: `sanitiseHandoffEntry` (pure) clears every reference to a ledger that does not
// exist after the rollback and names it, so the editor shows an empty pick instead of a dangling id.
import type { VoucherKind } from '../domain'
import type { AccountingFormState, InvoiceFormState, ManufactureFormState, PhysicalFormState, TaxSide } from '../voucherEdit'
import type { IntentRole, SimpleIntentInput, SimpleIntentKind } from './intents'

/** How the editor makes an account the rehearsal had to create, the way it does on first use:
 *  the counter's walk-in customer (counter.ts ensureWalkIn), a GST ledger of the bill's side
 *  (pickers.tsx useTaxLedgers.ensure), the Round Off ledger (ensureRoundOff). */
export type HandoffCreate = { kind: 'walkIn' } | { kind: 'tax'; taxType: 'cgst' | 'sgst' | 'igst' | 'cess'; side: TaxSide } | { kind: 'roundOff' }

/** An account the answers use that does not exist yet and that the editor creates when the user
 *  saves (unless they pick another): its name shows in the empty pick. */
export interface HandoffPending {
  name: string
  create: HandoffCreate
}

/** Where those accounts go: the bill's party (invoice form) / the rows (accounting form, by index). */
export interface HandoffPendingRefs {
  party?: HandoffPending
  rows?: (HandoffPending | null)[]
}

interface EntryBase {
  role: IntentRole
  kind: VoucherKind
  voucherTypeId: number
  amount: number
  /** Accounts created on save (absent = none). */
  pending?: HandoffPendingRefs
}

export type HandoffEntry =
  | (EntryBase & { form: 'invoice'; state: InvoiceFormState })
  | (EntryBase & { form: 'accounting'; state: AccountingFormState })
  | (EntryBase & { form: 'physical'; state: PhysicalFormState })
  | (EntryBase & { form: 'manufacture'; state: ManufactureFormState })

export interface IntentFormResult {
  kind: SimpleIntentKind
  /** In the order simple:post would save them (the bill / note first, then its payment / refund). */
  entries: HandoffEntry[]
  /** Accounts the answers need that do not exist yet and that the user picks or creates in the
   *  editor — shown as empty picks. */
  missing: string[]
  /** Accounts that do not exist yet and that the editor creates on save, as it does on first use
   *  (the walk-in customer, GST / round-off ledgers) — their names show in the picks. */
  addedOnSave?: string[]
}

/** What the full editor is opened with (a nav param — nothing stored). */
export interface SimpleHandoff {
  /** The simple screen it came from (registry name) — "Back to simple" returns there. */
  from: string
  kind: SimpleIntentKind
  /** The answers it was made from (what simple:intentForm mapped) — "Back to simple" from an
   *  unsaved editor carries its changes back over them (shared/simple/carryBack.ts). */
  intent?: SimpleIntentInput
  entry: HandoffEntry
  /** The other parts of the same answers (a payment made now, a refund), not in this editor. */
  others: { role: IntentRole; kind: VoucherKind; amount: number }[]
  missing: string[]
  addedOnSave?: string[]
  /** Phase 5: this editor is the SECOND step — the money paid / received / refunded now for the
   *  entry the first step saved (its bill-wise name). */
  afterBill?: string
}

/** simple:handoffTarget — the facts "Back to simple" needs from main (services/simpleHandoff.ts). */
export interface HandoffFacts {
  /** Absent when the voucher is not in the books (binned, optional, post-dated) or not found. */
  voucher?: {
    id: number
    kind: VoucherKind
    originalId: number | null
    /** Phase 5 (asked with `open`): the hand-off's second step — its date, party and what of it is
     *  still open (SavedFirstStep). */
    date?: string
    partyId?: number | null
    open?: { name: string; amount: number } | null
  }
  ledger?: { id: number; isParty: boolean }
}

/** Clear every reference to a ledger that does not exist (after the rehearsal's rollback). One the
 *  editor makes on first use (`describe` gives how) becomes a pending account, created on save
 *  and named in the pick (`addedOnSave`); any other is named in `missing` (pick or create it). An
 *  existing ledger — the counter's own "Cash sale" walk-in included — is kept as it is. The bill
 *  name follows the voucher number again when it was only the number (the editor numbers a new
 *  entry itself, so a number taken meanwhile never sticks to the bill). */
export function sanitiseHandoffEntry(
  entry: HandoffEntry,
  exists: (ledgerId: number) => boolean,
  describe: (ledgerId: number) => { name: string; create: HandoffCreate | null } | null
): { entry: HandoffEntry; missing: string[]; addedOnSave: string[] } {
  const missing: string[] = []
  const addedOnSave: string[] = []
  const add = (list: string[], name: string): void => {
    if (name && !list.includes(name)) list.push(name)
  }
  /** The id kept, or null + the pending account. */
  const check = (id: number | null): { id: number | null; pending: HandoffPending | null } => {
    if (id == null || exists(id)) return { id, pending: null }
    const d = describe(id)
    if (d?.create) {
      add(addedOnSave, d.name)
      return { id: null, pending: { name: d.name, create: d.create } }
    }
    if (d) add(missing, d.name)
    return { id: null, pending: null }
  }
  const out = (e: HandoffEntry, pending: HandoffPendingRefs): { entry: HandoffEntry; missing: string[]; addedOnSave: string[] } => {
    const { pending: _old, ...rest } = e
    const any = pending.party != null || (pending.rows ?? []).some((p) => p != null)
    return { entry: (any ? { ...rest, pending } : rest) as HandoffEntry, missing, addedOnSave }
  }
  switch (entry.form) {
    case 'invoice': {
      const s = entry.state
      const billName = s.billName && s.billName === s.number ? '' : s.billName
      const party = check(s.partyId)
      const account = check(s.accountId)
      return out(
        { ...entry, state: { ...s, number: '', billName, partyId: party.id, accountId: account.id } },
        party.pending ? { party: party.pending } : {}
      )
    }
    case 'accounting': {
      const s = entry.state
      const checked = s.rows.map((r) => check(r.ledgerId))
      return out(
        { ...entry, state: { ...s, number: '', rows: s.rows.map((r, i) => ({ ...r, ledgerId: checked[i]!.id })) } },
        checked.some((c) => c.pending) ? { rows: checked.map((c) => c.pending) } : {}
      )
    }
    case 'physical':
      return out({ ...entry, state: { ...entry.state, number: '' } }, {})
    case 'manufacture': {
      const s = entry.state
      // null = Wages Payable — what the editor creates on first use anyway.
      const credit = s.labourCreditLedgerId != null && !exists(s.labourCreditLedgerId) ? null : s.labourCreditLedgerId
      return out({ ...entry, state: { ...s, number: '', labourCreditLedgerId: credit } }, {})
    }
  }
}

/** The simple screen an intent is filled in on (where "Back to simple" returns for an unsaved
 *  hand-off). */
export const INTENT_SCREEN: Record<SimpleIntentKind, string> = {
  sale: 'simple-sell',
  purchase: 'simple-buy',
  money_in: 'simple-money-in',
  money_out: 'simple-money-out',
  move_money: 'simple-move-money',
  return_sale: 'simple-return-sale',
  return_purchase: 'simple-return-purchase',
  stock_count: 'simple-stock-count',
  make_goods: 'simple-made-goods'
}

// ---------------------------------------------------------------- the second step (Phase 5)

/** What the first step's editor saved, as the books hold it now (simple:handoffTarget with
 *  `open`; absent there = binned / not in the books, and no second step is offered). */
export interface SavedFirstStep {
  voucherId: number
  date: string
  /** The saved entry's customer / supplier (null when the editor saved none). */
  partyId: number | null
  /** What of THAT entry is still open as on its date (the Outstandings allocation): a bill's
   *  pending (sale / purchase) or a return note's own credit; null = nothing (settled). */
  open: { name: string; amount: number } | null
}

/** The money part of a hand-off that the first editor did not hold. */
export function moneyPartOf(h: Pick<SimpleHandoff, 'others'>): { role: IntentRole; kind: VoucherKind; amount: number } | null {
  return h.others.find((o) => (o.role === 'payment' || o.role === 'refund') && o.amount > 0) ?? null
}

type MoneyAnswer = { how: 'cash' | 'upi' | 'card' | 'bank'; accountId?: number; reference?: string }
type WithoutClientId<T> = T extends unknown ? Omit<T, 'clientId'> : never
/** A money intent without its clientId (the hand-off's own is added by openHandoff). */
export type FollowUpIntent = WithoutClientId<Extract<SimpleIntentInput, { kind: 'money_in' | 'money_out' }>>

/**
 * Phase 5 — the deferred gap of WP 9.10 closed as a clear TWO-STEP hand-off: once the full editor
 * has saved the bill (or return note) of a simple form's answers, the money paid / received /
 * refunded NOW becomes its own entry — a WP 9.1 money intent the editor's mapping turns into the
 * receipt / payment form (simple:intentForm, nothing saved), set against THAT saved entry by name
 * and never for more than it still has open (the editor may have changed it):
 *  - a sale / purchase paid now: money in / out for the customer / supplier against the bill
 *    (its voucher id + bill-wise name);
 *  - a return refunded now: money out to the customer / in from the supplier against the note's
 *    own credit (by name — never an older advance first).
 * Pure. null = nothing left to record (no money part, no party, the entry settled).
 */
export function followUpIntent(h: Pick<SimpleHandoff, 'kind' | 'intent' | 'others'>, saved: SavedFirstStep): FollowUpIntent | null {
  const part = moneyPartOf(h)
  type Answer = { how: string; accountId?: number; reference?: string }
  const intent = h.intent as { payment?: Answer; refund?: Answer; narration?: string } | undefined
  if (!part || !intent || saved.partyId == null || !saved.open || saved.open.amount <= 0) return null
  const answer = h.kind === 'sale' || h.kind === 'purchase' ? intent.payment : intent.refund
  if (!answer || answer.how === 'credit') return null
  const money: MoneyAnswer = {
    how: answer.how as MoneyAnswer['how'],
    ...(answer.accountId != null ? { accountId: answer.accountId } : {}),
    ...(answer.reference ? { reference: answer.reference } : {})
  }
  const amount = Math.min(part.amount, saved.open.amount)
  const base = { date: saved.date, amount, ...(intent.narration ? { narration: intent.narration } : {}) }
  const bills = [{ name: saved.open.name, amount, ...(h.kind === 'sale' || h.kind === 'purchase' ? { billId: saved.voucherId } : {}) }]
  switch (h.kind) {
    case 'sale':
      return { kind: 'money_in', ...base, into: money, customerId: saved.partyId, bills }
    case 'purchase':
      return { kind: 'money_out', ...base, from: money, supplierId: saved.partyId, bills }
    case 'return_sale':
      return { kind: 'money_out', ...base, from: money, customerId: saved.partyId, bills }
    case 'return_purchase':
      return { kind: 'money_in', ...base, into: money, supplierId: saved.partyId, bills }
    default:
      return null
  }
}
