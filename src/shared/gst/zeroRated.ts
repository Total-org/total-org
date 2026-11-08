// Phase 2 (audit 2026-11, "wrong money on a customer's bill"): the tax a NEW bill charges a party
// flagged as an SEZ unit / developer or an export buyer (ledgers.export_type). The returns
// (gst.ts outwardSupplyClass) and the e-invoice (edocs.ts supTypFor) already classify these
// documents; this is the same rule for the bill itself (voucherEdit/invoice.ts computeInvoice,
// the simple Make a bill / simple:post amount lines), so the bill, GSTR-1, GSTR-3B and the
// e-invoice carry the same tax. Pure: no DB, no UI. Tax rules are never written from memory —
// each rule below quotes the official text it rests on.
//
// Sources (read 2026-11-08 on the CBIC tax information portal):
//  - IGST Act s.7(5): "Supply of goods or services or both,- (a) when the supplier is located in
//    India and the place of supply is outside India; (b) to or by a Special Economic Zone developer
//    or a Special Economic Zone unit; or (c) … shall be treated to be a supply of goods or services
//    or both in the course of inter-State trade or commerce."
//    https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteriv/section7_v1.00.html
//    → an SEZ supply is INTER-state even when the unit is in the supplier's own state: IGST,
//      never CGST + SGST; an export likewise.
//  - IGST Act s.16(1): "'zero rated supply' means any of the following supplies of goods or
//    services or both, namely: (a) export of goods or services or both; or (b) supply of goods or
//    services or both [for authorised operations] to a Special Economic Zone developer or a Special
//    Economic Zone unit." s.16(3) (as substituted by s.123 of the Finance Act, 2021, in force from
//    1 October 2023, Notification 27/2023-CT): "A registered person making zero rated supply shall
//    be eligible to claim refund of unutilised input tax credit on supply of goods or services or
//    both, without payment of integrated tax, under bond or Letter of Undertaking …"; s.16(4): the
//    Government may notify "a class of persons who may make zero rated supply on payment of
//    integrated tax and claim refund of the tax so paid" / "a class of goods or services …".
//    https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chaptervii/section16_v1.00.html
//    → WITHOUT payment (under bond / LUT): the bill charges no IGST (the rate stays on the line —
//      GSTR-1 SEWOP / EXPWOP report rt with iamt 0, the e-invoice GstRt with IgstAmt 0); WITH
//      payment: IGST at the line's rate (and cess), inter-state.
//
// UNVERIFIED (GST_UNVERIFIED 'zero-rated-with-payment', a "check with your CA" point on the party
// form): which classes of persons / goods / services may still export or supply to an SEZ ON
// payment of IGST since 1 October 2023 (s.16(4) notifications) — Total does not check it; the
// party's flag is the user's choice. Also unconfirmed: a credit note to such a party follows the
// same class as its bill (the returns already report it so — CDNR / CDNUR of an SEWOP / EXPWOP).
//
// Kept exactly as before: a party with NO flag (also a state code 96 / 97 buyer — the returns call
// it EXPWOP but the e-invoice keeps its computed IGST; that difference is untouched here), every
// purchase-side document (a purchase or debit note — the flag describes the party as a buyer), and
// every SAVED bill (invoice.ts `legacyZeroRated`: a bill saved before this rule loads and saves
// back exactly as it was saved until its inputs change).

import type { VoucherKind } from '../domain'
import { supplyTypeFor, type SupplyType } from './calc'

export type PartyExportType = 'sez_wp' | 'sez_wop' | 'exp_wp' | 'exp_wop'

/** The zero-rated class of a supply to a party with this flag (IGST Act s.16(1)); null = none. */
export interface ZeroRatedClass {
  /** s.16(1)(b) SEZ developer / unit, else (a) export. */
  sez: boolean
  /** s.16(3): true = on payment of IGST; false = without payment under bond / LUT (no tax). */
  withPayment: boolean
}

export function zeroRatedClass(exportType: PartyExportType | null | undefined): ZeroRatedClass | null {
  switch (exportType) {
    case 'sez_wp': return { sez: true, withPayment: true }
    case 'sez_wop': return { sez: true, withPayment: false }
    case 'exp_wp': return { sez: false, withPayment: true }
    case 'exp_wop': return { sez: false, withPayment: false }
    default: return null
  }
}

/** Only the OUTWARD documents of the bill editors follow the party's flag: a sales invoice and a
 *  credit note (taxSideOf 'output'). A debit note is kept as before (it may be a purchase return). */
export const zeroRatedKind = (kind: VoucherKind): boolean => kind === 'sales' || kind === 'credit_note'

export interface BillTaxClass {
  supply: SupplyType
  /** true = a zero-rated supply without payment: the lines keep their rate, no tax is charged. */
  zeroTax: boolean
  /** The class applied (null = an ordinary supply, decided by the place of supply as before). */
  zeroRated: ZeroRatedClass | null
}

/**
 * How a bill to this party is taxed: a zero-rated supply (the party flagged SEZ / export, an
 * outward kind) is inter-state (s.7(5)) and, without payment, untaxed (s.16(3)); anything else is
 * intra / inter by the place of supply — explicit override → party state → company state, the
 * precedence the editor always used.
 */
export function billTaxClass(
  companyStateCode: string,
  kind: VoucherKind,
  party: { stateCode: string | null; exportType?: PartyExportType | null } | undefined,
  posOverride: string | null
): BillTaxClass {
  const zeroRated = zeroRatedKind(kind) ? zeroRatedClass(party?.exportType) : null
  if (zeroRated) return { supply: 'inter', zeroTax: !zeroRated.withPayment, zeroRated }
  return { supply: supplyTypeFor(companyStateCode, posOverride ?? party?.stateCode ?? companyStateCode), zeroTax: false, zeroRated: null }
}
