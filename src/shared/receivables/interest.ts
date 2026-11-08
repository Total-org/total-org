/**
 * Day helpers for the receivables module (and simple People / the approval queue).
 *
 * The file once held the interest-on-overdue-bills maths (WP 4.2); that feature was removed
 * (audit A13b). Old books keep their interest debit notes as ordinary vouchers — nothing
 * recomputes them, so only the date helpers remain.
 */
const DAY_MS = 86_400_000

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (to − from); negative when `to` is earlier. */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}
