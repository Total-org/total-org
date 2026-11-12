// Audit A8 / UX-3: which ledgers a bill's party picker offers, and in what order. Tally's sales
// voucher lists debtors / creditors / cash / bank — never a tax, income or expense ledger as the
// "buyer". The side comes from the group's ROLE (`partyRoleOf` — the seeded Sundry Debtors /
// Creditors or an imported "Trade Receivables", "Accounts Payable" …), never a seeded name alone.
// Only the list changes: whatever the voucher already names stays pickable, and the save path
// accepts the same parties it always did.
import { partyRoleOf, type PartyGroupLink } from '../chartOfAccounts'
import { CASH_BANK_GROUPS } from '../seed'

/** The side of the document: a sale / credit note / delivery challan / quotation / sales order is
 *  'sales' (a customer); a purchase / debit note / GRN / purchase order is 'purchase' (a supplier). */
export type PartySide = 'sales' | 'purchase'

export interface PartyListGroup extends PartyGroupLink {
  nature: string
}

export interface PartyListLedger {
  id: number
  name: string
  groupId: number
  taxType?: string | null
}

/** 0 = this side's parties (customers on a sale, suppliers on a purchase), 1 = cash / bank, 2 = the
 *  other side's parties, 3 = any other balance-sheet ledger (a loan, a branch …); null = never
 *  offered: income / expense ledgers, Duties & Taxes and any ledger tagged as a GST ledger. */
export function partyRank(ledger: PartyListLedger, byId: ReadonlyMap<number, PartyListGroup>, side: PartySide): 0 | 1 | 2 | 3 | null {
  if (ledger.taxType) return null
  const role = partyRoleOf(ledger.groupId, byId)
  if (role) return (role === 'debtor') === (side === 'sales') ? 0 : 2
  const seen = new Set<number>()
  let g = byId.get(ledger.groupId)
  let cashBank = false
  let nature: string | undefined
  while (g && !seen.has(g.id)) {
    seen.add(g.id)
    nature = g.nature
    if (g.name === 'Duties & Taxes') return null
    if (CASH_BANK_GROUPS.includes(g.name)) cashBank = true
    g = g.parentId != null ? byId.get(g.parentId) : undefined
  }
  if (nature === 'income' || nature === 'expense') return null
  return cashBank ? 1 : 3
}

/**
 * The picker's ledgers in order: rank, then the parties used most recently on this side
 * (`recentIds`, newest first), then the incoming order (the masters list is by name). The ledger
 * already picked (`keepId`) is always included, whatever its rank, so a saved bill whose party sits
 * elsewhere still loads and shows it.
 */
export function partyPickerLedgers<L extends PartyListLedger>(
  ledgers: readonly L[],
  groups: readonly PartyListGroup[],
  side: PartySide,
  recentIds: readonly number[] = [],
  keepId: number | null = null
): L[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const recent = new Map(recentIds.map((id, i) => [id, i]))
  const ranked: { l: L; rank: number; recent: number; at: number }[] = []
  ledgers.forEach((l, at) => {
    const r = partyRank(l, byId, side)
    if (r == null && l.id !== keepId) return
    ranked.push({ l, rank: r ?? 4, recent: recent.get(l.id) ?? Number.MAX_SAFE_INTEGER, at })
  })
  ranked.sort((a, b) => a.rank - b.rank || a.recent - b.recent || a.at - b.at)
  return ranked.map((x) => x.l)
}
