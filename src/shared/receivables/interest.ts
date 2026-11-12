/**
 * Day helpers for the receivables module (and simple People / the approval queue).
 *
 * The file once held the interest-on-overdue-bills maths (WP 4.2); that feature was removed
 * (audit A13b). Old books keep their interest debit notes as ordinary vouchers — nothing
 * recomputes them, so only the date helpers remain.
 */
import { addDaysISO, daysBetweenISO } from '../dates'

/** `days` after `date` — dates.ts's (HEALTH-2). */
export const addDaysIso = addDaysISO

/** Whole days from `from` to `to` (to − from); negative when `to` is earlier — dates.ts's (HEALTH-2). */
export const daysBetweenIso = daysBetweenISO
