/**
 * WP 2d (owner, 13 Nov; review of #277): the journal a simple purchase posts beside a bill whose GST
 * can't be claimed back (s.17(5)) — Dr the bill's account, Cr its input tax — is that bill's partner.
 * The link is the simple:post record (`simple_posts.voucher_ids_json`: role 'bill' + role 'gst_cost').
 * Binning the bill bins its journal (the journal alone would leave the cost and a GST credit with no
 * bill); restoring the bill brings it back. A journal binned on its own simply stops moving the GST.
 */
import type { DB } from '../db/connection'
import { writeAudit } from './audit'
import { getVoucher } from './vouchers'

interface PostEntry { role: string; voucherId: number }

/** The bill's (or a purchase return note's) gst_cost journal, live or binned, with its cost account
 *  (the account the journal debits — for a return's mirror, the one it credits); null = none. */
export function gstCostJournalOf(db: DB, billId: number): { journalId: number; accountId: number } | null {
  const rows = db
    .prepare("SELECT voucher_ids_json AS ids FROM simple_posts WHERE kind IN ('purchase', 'return_purchase') AND voucher_ids_json LIKE ?")
    .all(`%"voucherId":${billId},%`) as { ids: string }[]
  for (const r of rows) {
    const entries = JSON.parse(r.ids) as PostEntry[]
    // A bill's journal, or a purchase return's (its note moves the returned GST back out of the cost).
    if (!entries.some((e) => (e.role === 'bill' || e.role === 'note') && e.voucherId === billId)) continue
    const j = entries.find((e) => e.role === 'gst_cost')
    if (!j) continue
    // The cost account is the journal's single non-tax line: Dr on a bill's, Cr on a return's.
    const side = entries.some((e) => e.role === 'note') ? 'cr' : 'dr'
    const acct = db.prepare('SELECT vl.ledger_id AS id FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id WHERE vl.voucher_id = ? AND vl.dr_cr = ? AND l.tax_type IS NULL ORDER BY vl.line_order, vl.id LIMIT 1').get(j.voucherId, side) as { id: number } | undefined
    if (acct) return { journalId: j.voucherId, accountId: acct.id }
  }
  return null
}

/** Inside deleteVoucher's transaction: binning a bill bins its live gst_cost journal too. */
export function binGstCostJournal(db: DB, billId: number, lock: string | null): void {
  const j = gstCostJournalOf(db, billId)
  if (!j) return
  const row = db.prepare('SELECT date, deleted_at AS deletedAt FROM vouchers WHERE id = ?').get(j.journalId) as { date: string; deletedAt: string | null } | undefined
  if (!row || row.deletedAt) return
  if (lock && row.date <= lock) throw new Error(`Books are locked up to ${lock} (the entry moving this bill's GST to the cost is dated ${row.date})`)
  const before = getVoucher(db, j.journalId)
  db.prepare("UPDATE vouchers SET deleted_at = datetime('now') WHERE id = ?").run(j.journalId)
  writeAudit(db, 'voucher', j.journalId, 'delete', before, { pairedWith: billId })
}

/** Inside restoreVoucher's transaction: restoring a bill brings back its binned gst_cost journal. */
export function restoreGstCostJournal(db: DB, billId: number): void {
  const j = gstCostJournalOf(db, billId)
  if (!j) return
  const row = db.prepare('SELECT deleted_at AS deletedAt FROM vouchers WHERE id = ?').get(j.journalId) as { deletedAt: string | null } | undefined
  if (!row?.deletedAt) return
  const before = getVoucher(db, j.journalId)
  db.prepare('UPDATE vouchers SET deleted_at = NULL WHERE id = ?').run(j.journalId)
  writeAudit(db, 'voucher', j.journalId, 'restore', before, { restored: true, pairedWith: billId })
}
