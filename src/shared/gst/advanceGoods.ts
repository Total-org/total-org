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
  // Review of #259: no remedy is prescribed. The customer's GST rate is read live for every month's
  // 11A AND 11B, so clearing it would move months already filed — that is said, for the CA to weigh.
  return (
    `${n} advance${n === 1 ? '' : 's'} in Table 11A ${n === 1 ? 'is' : 'are'} from customers you sell goods to (${shown}). ` +
    'GST on goods is due when you invoice, not on an advance (Notification 66/2017-Central Tax, s.12(2)(a) CGST Act); ' +
    'only advances for services are taxed on receipt. Check these with your CA before changing anything: the GST rate on a ' +
    'customer’s account puts ALL their advances in Table 11A and 11B, in every month — clearing it changes months already filed.'
  )
}

/**
 * R3 / FIG-G-2 — advances Table 11A can't carry. GSTR-1 11A reads only customers whose account has a
 * GST rate (services/gst.ts `extractAdvances`), so an advance from a customer WITHOUT one is left out,
 * and that may be tax due: s.13(2) CGST Act makes the receipt of payment the time of supply of a
 * service, and rule 50's proviso says "where at the time of receipt of advance,- (i) the rate of tax is
 * not determinable, the tax shall be paid at the rate of eighteen per cent.; (ii) the nature of supply is
 * not determinable, the same shall be treated as inter-State supply" (CBIC copies, read 2026-11-18). A
 * blank rate on an account is not the same as "not determinable" (an exempt service owes nothing;
 * goods carry no tax on an advance — Notification 66/2017-CT), so this only WARNS (gstValidate
 * `advance_no_rate`, simple Taxes step 1) and never reports a rate by itself.
 */

/** One receipt that opened an advance (a 'new' bill ref) from a customer without a GST rate. */
export interface AdvanceReceipt {
  partyId: number
  partyName: string
  voucherId: number
  /** The bill name the advance opened. */
  name: string
  /** The advance's amount (paise, as received — tax-inclusive). */
  amount: number
}

/**
 * The receipts whose advance is not wholly used by a sales invoice of the same period. Table 11A is
 * "Advance amount received in the tax period for which invoice has not been issued", so an advance
 * an invoice of the period takes (an `against` ref of the same customer and name — what 11B reads)
 * is not 11A's. `used` = per `${partyId}|${name}` what the period's invoices took; it is set against
 * that name's receipts in the order given (oldest first), and a receipt with anything left is open.
 */
export function openAdvanceReceipts(receipts: readonly AdvanceReceipt[], used: ReadonlyMap<string, number>): AdvanceReceipt[] {
  const left = new Map(used)
  return receipts.filter((r) => {
    const key = `${r.partyId}|${r.name}`
    const take = Math.min(left.get(key) ?? 0, r.amount)
    left.set(key, (left.get(key) ?? 0) - take)
    return take < r.amount
  })
}

export function rateLessAdvanceMessage(parties: readonly AdvanceParty[]): string {
  const names = parties.map((p) => p.partyName)
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
  const n = parties.reduce((s, p) => s + p.voucherIds.length, 0)
  // Review of R3 (the CA-style reviewer): never say tax IS due, name both returns, say the 11B
  // adjustment then needs a hand too, and say what a rate on the account would do to filed months.
  return (
    `${n} advance${n === 1 ? '' : 's'} received in this period ${n === 1 ? 'is' : 'are'} not in Table 11A, because the customer’s account has no GST rate (${shown}). ` +
    'If an advance is for a taxable service, its GST counts in the period you received it (s.13(2) CGST Act; rule 50: at 18 % if the rate can’t be known yet, and as inter-State if the nature of the supply can’t be known); ' +
    'an advance for goods carries no GST until the invoice (Notification 66/2017-Central Tax). Ask your CA. ' +
    'If it is taxable, add it to Table 11A of GSTR-1 and to GSTR-3B on the portal yourself — Total will then not take it off in Table 11B when you invoice, so adjust that by hand too. ' +
    'Setting a GST rate on the customer’s account instead puts ALL their advances in Tables 11A and 11B, in every month — months already filed included.'
  )
}
