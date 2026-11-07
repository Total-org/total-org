/**
 * Ticking an open bill in an editor's bill-wise section (receipt / payment / note) — audit A1,
 * COR-2. Pure, shared by AccountingEntry and InvoiceEntry so they cannot drift.
 *
 * The bill takes what is still unallocated of the entry's party amount, at most its pending.
 * Nothing typed yet (`entryTotal` ≤ 0) → the whole pending (the editors' long-standing shortcut:
 * tick first, the amount follows). Everything already allocated → null: the tick is refused (it
 * used to add the whole bill on top — `remaining || pending` — and the save was then refused with
 * "bill references must add up").
 */
export function tickBillAmount(pending: number, entryTotal: number, allocated: readonly { amount: number }[]): number | null {
  if (pending <= 0) return null
  if (entryTotal <= 0) return pending
  const remaining = entryTotal - allocated.reduce((s, r) => s + r.amount, 0)
  return remaining > 0 ? Math.min(pending, remaining) : null
}

export const BILL_TICK_FULL_MESSAGE = 'The whole amount is already set against other bills — lower one of them first'
