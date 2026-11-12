/**
 * Advances for GOODS carry no GST (WP 2d) — pure.
 *
 * Notification 66/2017-Central Tax (15 November 2017, under s.148 CGST Act; GST_SOURCES.n66_2017):
 * "the registered person who did not opt for the composition levy under section 10 ... [is notified]
 * as the class of persons who shall pay the central tax on the outward supply of goods at the time of
 * supply as specified in clause (a) of sub-section (2) of section 12" — the invoice (or the last day
 * to issue it), not the receipt of an advance. Advances for SERVICES stay taxable on receipt (s.13).
 *
 * The books do not say what a receipt was an advance FOR, so this only WARNS (gstValidate,
 * `advance_goods`) — Table 11A is computed exactly as before. A customer is taken to buy goods when
 * the HSN / SAC codes on their sales (any date up to the period end) are all goods codes; with no
 * coded sale of theirs, the business's own coded sales decide. SAC codes are chapter 99 (services);
 * every other 4–8 digit code is a goods HSN.
 */

export type SupplyKind = 'goods' | 'services'

/** Goods or services by an HSN / SAC code; null when the code is missing or not a code. */
export function supplyKindOfHsn(hsn: string | null | undefined): SupplyKind | null {
  const code = (hsn ?? '').trim()
  if (!/^\d{4,8}$/.test(code)) return null
  return code.startsWith('99') ? 'services' : 'goods'
}

/** How many coded sale lines are goods / services. */
export interface SupplyCounts { goods: number; services: number }

/** One customer whose advance sits in Table 11A for the period. */
export interface AdvanceParty {
  partyId: number
  partyName: string
  /** The receipts that opened the advances (for the issues panel). */
  voucherIds: number[]
  /** This customer's coded sale lines. */
  sales: SupplyCounts
}

const goodsOnly = (c: SupplyCounts): boolean => c.goods > 0 && c.services === 0
const coded = (c: SupplyCounts): boolean => c.goods + c.services > 0

/** The customers whose advances look like advances for goods (in the order given). */
export function goodsAdvanceParties(parties: readonly AdvanceParty[], business: SupplyCounts): AdvanceParty[] {
  return parties.filter((p) => (coded(p.sales) ? goodsOnly(p.sales) : goodsOnly(business)))
}

export function goodsAdvanceMessage(parties: readonly AdvanceParty[]): string {
  const names = parties.map((p) => p.partyName)
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
  const n = parties.reduce((s, p) => s + p.voucherIds.length, 0)
  return (
    `${n} advance${n === 1 ? '' : 's'} in Table 11A ${n === 1 ? 'is' : 'are'} from customers you sell goods to (${shown}). ` +
    'GST on goods is due when you invoice, not on an advance (Notification 66/2017-Central Tax, s.12(2)(a) CGST Act); ' +
    'only advances for services are taxed on receipt. If these advances are for goods, clear the GST rate on the customer’s account so they leave Table 11A.'
  )
}
