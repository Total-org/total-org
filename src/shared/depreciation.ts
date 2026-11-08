/**
 * Date + integer helpers left from the fixed-asset register's depreciation engine (WP 3.6). The
 * register was removed in the feature cleanup (audit A13b) and its maths with it; what stays is
 * used by the s.18(6) capital-goods computation (./capitalGoodsGst.ts: addMonths, mulDivRound) and
 * the year-end depreciation status (services/fixedAssets.ts `yearStatus`: lifeEndDate). No I/O.
 */

// ---------------------------------------------------------------------------------------------
// Date + integer helpers
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS)
}

/** Days from `from` to `to`, both inclusive; 0 when `to` is before `from`. */
export function daysInclusive(from: string, to: string): number {
  if (to < from) return 0
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1
}

/** Calendar months after `iso`, the day clamped to the target month's length (31 Jan + 1 = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = total % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Last day of the useful life: put-to-use + life months − 1 day (10 years from 1 Apr 2025 ends 31 Mar 2035). */
export function lifeEndDate(putToUseDate: string, lifeMonths: number): string {
  return addDays(addMonths(putToUseDate, lifeMonths), -1)
}

/** round(a × b ÷ c), half away from zero, exact (BigInt) — the single rounding step of every charge.
 *  Each argument must itself be a safe integer; the product is formed in BigInt. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c === 0) throw new Error('mulDivRound: division by zero')
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(c)) throw new Error('mulDivRound: arguments must be safe integers')
  const A = BigInt(Math.trunc(a))
  const B = BigInt(Math.trunc(b))
  const C = BigInt(Math.trunc(c))
  const num = A * B
  const neg = num < 0n !== C < 0n
  const n = num < 0n ? -num : num
  const d = C < 0n ? -C : C
  const q = (n * 2n + d) / (d * 2n)
  return Number(neg ? -q : q)
}
