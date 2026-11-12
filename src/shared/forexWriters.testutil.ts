// The forex WRITER maths (rate entry, exposure folding, FIFO allocation, realised-difference
// settlement). The writers were removed in the 1.0 cleanup (#195) — revaluation / settlement
// vouchers can no longer be made — so this lives beside the test utilities that still build the
// older books they made (audit A11 / HEALTH-1: moved out of the production module, unchanged).
import { mulDivRound } from './intMath'
import { fcFromInr, inrFromFc, type ForeignBill } from './forex'

/** Parse "83.25" into micro-rupees (exact decimal parse, no float rounding); null if invalid. */
export function parseRateMicro(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(t)) return null
  const [whole, frac = ''] = t.split('.')
  const v = Number(whole) * 1_000_000 + Number((frac + '000000').slice(0, 6))
  return v > 0 ? v : null
}

/** One voucher line on an exposure ledger, in chronological order. */
export interface FxLine {
  date: string
  voucherId: number
  /** Signed paise, dr-positive. */
  amount: number
  /** The voucher's currency (null / 'INR' = a rupee voucher). */
  currency: string | null
  /** The voucher's rate in micro-rupees (null for a rupee voucher). */
  rateMicro: number | null
  /** Explicit foreign amount for this line (signed fc minor) — a recorded settlement's party line. */
  fcOverride: number | null
  /** A revaluation (or its reversal) journal: moves rupees only, never the foreign balance. */
  revaluation: boolean
}

export interface Exposure {
  /** Signed fc minor (dr-positive): + is owed to us / held, − is owed by us. */
  fcBalance: number
  /** Signed paise of the foreign-currency lines only (dr-positive) — their book value in rupees. */
  inrBook: number
  /** inrBook / fcBalance in micro-rupees, null when nothing is open. */
  carryingRateMicro: number | null
  /** Rupee lines on the ledger that carry no foreign amount. They are NOT foreign money and are
   *  left out of both the foreign balance and its book value (so they are never revalued). */
  rupeeLines: number
}

/**
 * Fold an exposure ledger's lines into its foreign balance and that balance's rupee book value:
 * - the foreign opening (fx_ledger_currency.opening_fc against the ledger's rupee opening), if any;
 * - a line on a voucher in `currency` carries fc = its override (a recorded settlement), else
 *   amount ÷ the voucher rate; its rupees count in the book value;
 * - a revaluation / reversal line moves the book value only;
 * - any other line is rupee money: excluded from both figures and counted in `rupeeLines`.
 */
export function foldExposure(lines: readonly FxLine[], currency: string, opening: { fc: number; inr: number } | null = null): Exposure {
  let fc = opening?.fc ?? 0
  let inr = opening?.inr ?? 0
  let rupee = 0
  for (const l of lines) {
    if (l.revaluation) {
      inr += l.amount
    } else if (l.fcOverride != null) {
      fc += l.fcOverride
      inr += l.amount
    } else if (l.currency === currency && l.rateMicro && l.rateMicro > 0) {
      fc += fcFromInr(l.amount, l.rateMicro)
      inr += l.amount
    } else {
      rupee++
    }
  }
  return { fcBalance: fc, inrBook: inr, carryingRateMicro: fc !== 0 ? Math.abs(mulDivRound(inr, 1_000_000, fc)) : null, rupeeLines: rupee }
}

/** Spread `fcAmount` over the open bills oldest first. */
export function allocateFifo(bills: readonly ForeignBill[], fcAmount: number): { name: string; fc: number }[] {
  const out: { name: string; fc: number }[] = []
  let rest = fcAmount
  for (const b of bills) {
    if (rest <= 0) break
    const t = Math.min(rest, b.fcOpen)
    out.push({ name: b.name, fc: t })
    rest -= t
  }
  if (rest > 0) throw new Error('More than the open foreign balance')
  return out
}

export interface SettlementLine { name: string; voucherId: number | null; fc: number; bookInr: number }

export interface SettlementSplit {
  lines: SettlementLine[]
  fcTotal: number
  /** Rupees moved through the bank (positive). */
  bankInr: number
  /** Book value of the bills relieved, each at its own rate (positive). */
  partyInr: number
  /** + realised gain, − realised loss. */
  gainLoss: number
}

/**
 * Realised exchange difference (AS 11 para 13 / Ind AS 21 para 28), bill by bill: each bill is
 * relieved at its OWN book rate (all of its book value when settled in full), the bank moves the
 * total foreign amount × the settlement rate. Receivable: more rupees in than carried = gain.
 * Payable: fewer rupees out = gain.
 */
export function settleBills(
  bills: readonly ForeignBill[],
  allocations: readonly { name: string; fc: number }[],
  settleRateMicro: number,
  side: 'receivable' | 'payable'
): SettlementSplit {
  if (allocations.length === 0) throw new Error('Pick at least one bill')
  const lines: SettlementLine[] = allocations.map((a) => {
    const b = bills.find((x) => x.name === a.name)
    if (!b) throw new Error(`Bill ${a.name} is not open`)
    if (!(a.fc > 0)) throw new Error(`Enter a positive amount for ${a.name}`)
    if (a.fc > b.fcOpen) throw new Error(`More than is open on ${a.name}`)
    return { name: b.name, voucherId: b.voucherId, fc: a.fc, bookInr: a.fc === b.fcOpen ? b.bookOpen : mulDivRound(b.bookOpen, a.fc, b.fcOpen) }
  })
  const fcTotal = lines.reduce((s, l) => s + l.fc, 0)
  const partyInr = lines.reduce((s, l) => s + l.bookInr, 0)
  const bankInr = inrFromFc(fcTotal, settleRateMicro)
  return { lines, fcTotal, bankInr, partyInr, gainLoss: side === 'receivable' ? bankInr - partyInr : partyInr - bankInr }
}
