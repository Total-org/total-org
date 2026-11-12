/**
 * Foreign-currency exposure and revaluation arithmetic (WP 4.4) — pure, no DB.
 *
 * Basis:
 * - AS 11 (revised 2003), The Effects of Changes in Foreign Exchange Rates, para 11(a): "foreign
 *   currency monetary items should be reported using the closing rate" at each balance sheet
 *   date; para 13: exchange differences arising on the settlement of monetary items, or on
 *   reporting them at rates different from those at which they were initially recorded, "should
 *   be recognised as income or as expenses in the period in which they arise" (para 46/46A
 *   options for long-term items are not modelled).
 * - Ind AS 21, para 23(a): "foreign currency monetary items shall be translated using the closing
 *   rate"; para 28: exchange differences on settling or translating monetary items are
 *   recognised in profit or loss in the period in which they arise.
 *   UNVERIFIED: paragraph numbers and quotations are from the standards as recalled — check them
 *   against the ICAI / MCA published text before relying on the citation.
 * Receivables, payables and foreign-currency bank balances are monetary items; the revaluation
 * journal restates them at the user-entered closing rate. Reversing it on the next day (Tally's
 * "adjustment" practice) keeps the original book rate on the party ledger for settlement, so the
 * realised difference is recognised when the bill is actually settled.
 *
 * Units: INR in paise (integer), foreign amounts in hundredths of the currency ("fc minor",
 * integer — the cent/penny for USD/GBP/EUR), rates as integer micro-rupees per unit
 * (₹83.25 / USD = 83 250 000). fc minor × rate micro / 10⁶ = paise.
 */
import { mulDivRound } from './intMath'

/** ₹ per unit as a decimal (voucher.exchange_rate, user input) → integer micro-rupees. */
export function rateToMicro(rate: number): number {
  return Math.round(rate * 1_000_000)
}

/** Integer micro-rupees → a display string with up to 6 decimals ("83.25"). */
export function microToRateText(micro: number): string {
  const s = (micro / 1_000_000).toFixed(6)
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

/** paise → fc minor at a rate (round half away from zero). */
export function fcFromInr(paise: number, rateMicro: number): number {
  return mulDivRound(paise, 1_000_000, rateMicro)
}

/** fc minor → paise at a rate (round half away from zero). */
export function inrFromFc(fcMinor: number, rateMicro: number): number {
  return mulDivRound(fcMinor, rateMicro, 1_000_000)
}

export interface RevaluationLine {
  /** Restated rupee value of the foreign balance at the closing rate (signed paise). */
  target: number
  /** target − inrBook: + debits the ledger (an asset grows / a liability shrinks), − credits it. */
  adjustment: number
  /** + is a gain, − a loss (equal to `adjustment`: a debit to a monetary item is a gain). */
  gainLoss: number
}

/** Restate one exposure at `closingRateMicro`. */
export function revalue(fcBalance: number, inrBook: number, closingRateMicro: number): RevaluationLine {
  const target = inrFromFc(fcBalance, closingRateMicro)
  const adjustment = target - inrBook
  return { target, adjustment, gainLoss: adjustment }
}

// ---------- bill-wise settlement ----------

/** One foreign bill (invoice / bill / the opening) still open, in positive magnitudes. */
export interface ForeignBill {
  name: string
  /** The invoice voucher (null = the ledger's foreign opening). */
  voucherId: number | null
  date: string
  /** Foreign amount still open (fc minor). */
  fcOpen: number
  /** Its rupee book value at the bill's own rate. */
  bookOpen: number
}

export interface ForeignEntry { name: string; voucherId: number | null; date: string; fc: number; inr: number }

/**
 * Open foreign bills: `bills` (positive, in date order) less `reductions` (foreign-currency credit
 * notes / returns — FIFO, at each bill's own rate) less earlier settlements by bill name.
 */
export function openForeignBills(
  bills: readonly ForeignEntry[],
  reductions: readonly { fc: number }[],
  settled: readonly { name: string; fc: number; bookInr: number }[]
): ForeignBill[] {
  const open: ForeignBill[] = bills.map((b) => ({ name: b.name, voucherId: b.voucherId, date: b.date, fcOpen: b.fc, bookOpen: b.inr }))
  const take = (b: ForeignBill, fc: number, book?: number): void => {
    const inr = book ?? (fc === b.fcOpen ? b.bookOpen : mulDivRound(b.bookOpen, fc, b.fcOpen))
    b.fcOpen -= fc
    b.bookOpen -= inr
  }
  for (const s of settled) {
    const b = open.find((x) => x.name === s.name && x.fcOpen > 0)
    if (b) take(b, Math.min(s.fc, b.fcOpen), s.fc >= b.fcOpen ? b.bookOpen : s.bookInr)
  }
  for (const r of reductions) {
    let rest = r.fc
    for (const b of open) {
      if (rest <= 0) break
      if (b.fcOpen <= 0) continue
      const t = Math.min(rest, b.fcOpen)
      take(b, t)
      rest -= t
    }
  }
  return open.filter((b) => b.fcOpen > 0)
}

/**
 * A foreign opening split over the party's opening bills (WP 8.7 bill-wise openings) — the same
 * rule as the opening itself: every bill is at the opening's ONE rate (the rate on the books-begin
 * day), so each bill's foreign amount is its rupee share of the opening (round half away from
 * zero), the last covered bill taking what rounding leaves so the bills add up to the foreign
 * opening exactly. A part of the opening the bills don't cover (never through the app) is its own
 * entry named `restName`. Magnitudes in, magnitudes out; `bills` in date order.
 */
export function openingBillsFc(
  opening: { fc: number; inr: number },
  bills: readonly { name: string; date: string; amount: number }[],
  restName: string
): { name: string; date: string; fc: number; inr: number }[] {
  const fcAll = Math.abs(opening.fc)
  const inrAll = Math.abs(opening.inr)
  if (inrAll === 0) return []
  const covered = bills.reduce((s, b) => s + b.amount, 0)
  const out: { name: string; date: string; fc: number; inr: number }[] = []
  let fcUsed = 0
  bills.forEach((b, i) => {
    const last = i === bills.length - 1 && covered === inrAll
    const fc = last ? fcAll - fcUsed : mulDivRound(fcAll, b.amount, inrAll)
    fcUsed += fc
    out.push({ name: b.name, date: b.date, fc, inr: b.amount })
  })
  if (covered !== inrAll) out.push({ name: restName, date: '0000-01-01', fc: fcAll - fcUsed, inr: inrAll - covered })
  return out.filter((b) => b.fc > 0 || b.inr > 0)
}

/** The rate behind a foreign opening (micro-rupees per unit), from its two amounts. */
export function impliedRateMicro(fc: number, inr: number): number | null {
  return fc !== 0 ? Math.abs(mulDivRound(inr, 1_000_000, fc)) : null
}

/** Format fc minor with two decimals and the code: 1234567 → "12,345.67 USD". */
export function formatFc(fcMinor: number, code: string): string {
  const neg = fcMinor < 0
  const abs = Math.abs(fcMinor)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  return `${neg ? '-' : ''}${whole}.${String(abs % 100).padStart(2, '0')} ${code}`
}
