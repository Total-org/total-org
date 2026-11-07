/**
 * Ticking an open bill in an editor's bill-wise section (receipt / payment / note) — audit A1,
 * COR-2. Pure, shared by AccountingEntry and InvoiceEntry so they cannot drift.
 *
 * An entry that SETTLES the party's side (a receipt from a customer, a credit note to one, a payment
 * to a supplier): the bill takes what is still unallocated of the entry's party amount, at most its
 * pending. Nothing typed yet (`entryTotal` ≤ 0) → the whole pending (the editors' long-standing
 * shortcut: tick first, the amount follows). Everything already allocated → 'full': the tick is
 * refused (it used to add the whole bill on top — `remaining || pending` — and the save was then
 * refused with "bill references must add up").
 *
 * An entry that RAISES it (`raises`: a debit note / refund to a customer, a credit note / refund
 * from a supplier) adds to the bill (shared/outstanding.ts, A1), so the bill's pending is no limit:
 * it takes what is left of the entry; with no amount yet → 'no_amount'.
 */
export type BillTick = number | 'full' | 'no_amount'

export function tickBillAmount(pending: number, entryTotal: number, allocated: readonly { amount: number }[], raises = false): BillTick {
  const remaining = entryTotal - allocated.reduce((s, r) => s + r.amount, 0)
  if (raises) return entryTotal <= 0 ? 'no_amount' : remaining > 0 ? remaining : 'full'
  if (pending <= 0) return 'full'
  if (entryTotal <= 0) return pending
  return remaining > 0 ? Math.min(pending, remaining) : 'full'
}

/** Whether an entry posting to the party on `partySide` raises what it owes on its side: a debit
 *  to a customer (debtor), a credit to a supplier (anyone else — the engine's side rule). */
export function raisesPartySide(role: 'debtor' | 'creditor' | null, partySide: 'dr' | 'cr'): boolean {
  return (role === 'debtor') === (partySide === 'dr')
}

export const BILL_TICK_MESSAGES: Record<'full' | 'no_amount', string> = {
  full: 'The whole amount is already set against other bills — lower one of them first',
  no_amount: 'Enter the amount first — the bill takes what this entry adds to it'
}
