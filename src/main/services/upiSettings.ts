import type { DB } from '../db/connection'
import { AppError } from '@shared/errors'
import { normalizeUpiSettings, upiPayLink, upiSettingsSchema, type UpiSettings } from '@shared/upi'
import type { PrintUpiInfo } from '@shared/print/render'
import { writeAudit } from './audit'
import { partyAllocation } from './analysis'

// A10 (audit 2026-11 PROD-8): the business's UPI ID (company meta `upi`) and the pay QR it puts
// on a sales invoice's print. Kept apart from config.ts (which printTemplates.ts is imported by).

const META_KEY = 'upi' // the meta row; missing = no UPI ID

function readStored(db: DB): unknown {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY) as { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

export function getUpiSettings(db: DB): UpiSettings {
  return normalizeUpiSettings(readStored(db))
}

/** Owner-only at the IPC layer; audited as a company update with the whole before / after.
 *  The same value again writes nothing; clearing a company that never had one writes nothing. */
export function setUpiSettings(db: DB, input: unknown): UpiSettings {
  const parsed = upiSettingsSchema.safeParse(input)
  if (!parsed.success) throw new AppError('upi_invalid', 'That is not a UPI ID (it looks like name@bank)', { field: 'upiId' })
  const after = parsed.data
  const before = getUpiSettings(db)
  const stored = readStored(db)
  if (before.upiId === after.upiId && (stored !== null || after.upiId === null)) return before
  db.transaction(() => {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(META_KEY, JSON.stringify(after))
    writeAudit(db, 'company', 0, 'update', { upi: stored === null ? null : before }, { upi: after })
  })()
  return after
}

/** What is still due on the sales bill `voucherId` as on `today` — its own row in the party's
 *  Outstandings allocation (by voucher id), never more than the bill's total. 0 for a bill with
 *  no party (a counter sale) or one paid / returned in full. */
export function billDueOn(db: DB, partyId: number | null, voucherId: number, totalPaise: number, today: string): number {
  if (partyId == null) return 0
  const open = partyAllocation(db, partyId, today).bills.find((b) => b.voucherId === voucherId)
  return Math.max(0, Math.min(open?.pending ?? 0, totalPaise))
}

/** The pay QR for a sales bill, or null (no UPI ID set, or nothing due). */
export function upiForBill(db: DB, company: { name: string }, bill: { voucherId: number; partyId: number | null; number: string; totalPaise: number }, today: string): PrintUpiInfo | null {
  const { upiId } = getUpiSettings(db)
  if (!upiId) return null
  const due = billDueOn(db, bill.partyId, bill.voucherId, bill.totalPaise, today)
  const link = upiPayLink({ upiId, payeeName: company.name, amountPaise: due, billNo: bill.number })
  return link ? { link, upiId, amountPaise: due } : null
}
