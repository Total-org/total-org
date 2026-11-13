// Owner, 13 Nov (audit 2 COR2-3, Q4): the supply a NEW credit note takes when it returns / is set
// against a sales bill saved before the zero-rated rule (#244) that charged GST the rule would not
// charge today (shared/gst/zeroRated.ts noteFollowsBill — CGST Act s.34, GST_SOURCES.s34). The full
// credit-note editor asks this (`voucher:noteFollows`) for the bills its lines return and the bills it
// is set against; simple Returns reads it inside loadOriginal. Read-only; nothing is stored.
import type { Database as DB } from 'better-sqlite3-multiple-ciphers'
import type { SupplyType } from '@shared/gst/calc'
import { noteFollowsBill, type PartyExportType } from '@shared/gst/zeroRated'

export interface NoteFollowsQuery {
  partyLedgerId: number | null
  /** Bill names the note is set `against` (the party's bills). */
  billNames: readonly string[]
  /** The bill lines its item lines return (`source.lineUid`). */
  lineUids: readonly string[]
}

/** The posted supply of a single sales voucher, when a note against it follows it (else null). */
export function billFollowSupply(db: DB, voucherId: number): SupplyType | null {
  const v = db
    .prepare(
      `SELECT vt.kind, l.export_type AS exportType FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
       LEFT JOIN ledgers l ON l.id = v.party_ledger_id WHERE v.id = ? AND v.deleted_at IS NULL`
    )
    .get(voucherId) as { kind: string; exportType: PartyExportType | null } | undefined
  if (!v || v.kind !== 'sales') return null
  const heads = db
    .prepare(
      `SELECT tl.tax_type AS t, COALESCE(SUM(CASE WHEN vl.dr_cr = 'cr' THEN vl.amount ELSE -vl.amount END), 0) AS amt
       FROM voucher_lines vl JOIN ledgers tl ON tl.id = vl.ledger_id
       WHERE vl.voucher_id = ? AND tl.tax_type IN ('cgst', 'sgst', 'igst') GROUP BY tl.tax_type`
    )
    .all(voucherId) as { t: 'cgst' | 'sgst' | 'igst'; amt: number }[]
  const posted = { cgst: 0, sgst: 0, igst: 0 }
  for (const h of heads) posted[h.t] = h.amt
  return noteFollowsBill('sales', v.exportType, posted)
}

/** The supply a new credit note follows: every sales bill it names must follow, at one supply;
 *  anything else (no such bill, an ordinary bill among them, two supplies) = null (today's rule). */
export function noteFollowsSupply(db: DB, q: NoteFollowsQuery): SupplyType | null {
  const ids = new Set<number>()
  const byLine = db.prepare(
    `SELECT v.id FROM inventory_lines il JOIN vouchers v ON v.id = il.voucher_id JOIN voucher_types vt ON vt.id = v.voucher_type_id
     WHERE il.line_uid = ? AND vt.kind = 'sales' AND v.deleted_at IS NULL`
  )
  for (const u of q.lineUids) for (const r of byLine.all(u) as { id: number }[]) ids.add(r.id)
  if (q.partyLedgerId != null) {
    const byBill = db.prepare(
      `SELECT v.id FROM bill_refs br JOIN vouchers v ON v.id = br.voucher_id JOIN voucher_types vt ON vt.id = v.voucher_type_id
       WHERE br.kind = 'new' AND br.name = ? AND br.party_ledger_id = ? AND vt.kind = 'sales' AND v.deleted_at IS NULL`
    )
    for (const n of q.billNames) for (const r of byBill.all(n, q.partyLedgerId) as { id: number }[]) ids.add(r.id)
  }
  if (ids.size === 0) return null
  const supplies = new Set([...ids].map((id) => billFollowSupply(db, id)))
  if (supplies.size !== 1) return null
  return [...supplies][0] ?? null
}
