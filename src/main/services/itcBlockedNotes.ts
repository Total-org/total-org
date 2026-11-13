// Owner, 13 Nov (audit 2 COR2-1, Q2): a debit note keeps the s.17(5) "GST credit blocked" mark it
// was saved with — only a NEW note follows the purchases it returns (vouchers.ts resolveItcBlocked).
// So nothing here changes a figure: it finds the debit notes whose mark no longer agrees with their
// purchases, for the save warning (a purchase re-marked) and gstValidate's `itc_blocked_note_mismatch`
// (CGST Act s.17(5), GST_SOURCES.s17; GSTR-3B 4(A)(5) / 4(B)(1) read each voucher by its own mark).
//
// A note's purchases (same rules as resolveItcBlocked, but dated): the purchases its lines return
// (`return` line links), and — same party, dated on or before the note — for each bill it is set
// `against` and for its reference, the LATEST purchase carrying that bill name / reference (bill
// numbers repeat across years: an older bill of the same number is never its original).
import type { Database as DB } from 'better-sqlite3-multiple-ciphers'
import { toDisplayDate } from '@shared/dates'

interface NoteRow { id: number; number: string; date: string; party: number | null; ref: string | null; blocked: number }

const CHUNK = 500

/** Debit notes (in the books' bin-free set) that post an input-tax line — the only ones Table 4 reads. */
const TAXED_NOTE = `nt.kind = 'debit_note' AND n.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM voucher_lines nl JOIN ledgers tl ON tl.id = nl.ledger_id WHERE nl.voucher_id = n.id AND tl.tax_type IS NOT NULL)`

/** Each note's purchases (ids), read in chunks of 500. */
export function notePurchases(db: DB, notes: readonly NoteRow[]): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>(notes.map((n) => [n.id, new Set<number>()]))
  const add = (id: number, p: number): void => void out.get(id)?.add(p)
  for (let i = 0; i < notes.length; i += CHUNK) {
    const chunk = notes.slice(i, i + CHUNK)
    const q = chunk.map(() => '?').join(',')
    for (const r of db
      .prepare(
        `SELECT ll.to_voucher_id AS note, ll.from_voucher_id AS p FROM line_links ll
         JOIN vouchers v ON v.id = ll.from_voucher_id JOIN voucher_types vt ON vt.id = v.voucher_type_id
         WHERE ll.link_type = 'return' AND ll.to_voucher_id IN (${q}) AND vt.kind = 'purchase' AND v.deleted_at IS NULL`
      )
      .all(...chunk.map((n) => n.id)) as { note: number; p: number }[]) add(r.note, r.p)
  }
  const latest = (party: number, date: string, where: string, value: string): number | null =>
    (db
      .prepare(
        `SELECT v.id FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
         WHERE vt.kind = 'purchase' AND v.deleted_at IS NULL AND v.party_ledger_id = ? AND v.date <= ? AND ${where}
         ORDER BY v.date DESC, v.id DESC LIMIT 1`
      )
      .get(party, date, value) as { id: number } | undefined)?.id ?? null
  const againstNames = db.prepare(`SELECT DISTINCT name FROM bill_refs WHERE voucher_id = ? AND kind = 'against' AND party_ledger_id = ?`)
  for (const n of notes) {
    if (n.party == null) continue
    for (const { name } of againstNames.all(n.id, n.party) as { name: string }[]) {
      const p = latest(n.party, n.date, `EXISTS (SELECT 1 FROM bill_refs b WHERE b.voucher_id = v.id AND b.kind = 'new' AND b.party_ledger_id = v.party_ledger_id AND b.name = ?)`, name)
      if (p != null) add(n.id, p)
    }
    if (n.ref) {
      const p = latest(n.party, n.date, 'v.reference = ?', n.ref)
      if (p != null) add(n.id, p)
    }
  }
  return out
}

const marksOf = (db: DB, ids: readonly number[]): Map<number, boolean> => {
  const out = new Map<number, boolean>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    for (const r of db.prepare(`SELECT id, COALESCE(itc_blocked, 0) AS b FROM vouchers WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { id: number; b: number }[]) out.set(r.id, r.b === 1)
  }
  return out
}

/** The mark every purchase of the note carries, when they all agree and the note's differs; null =
 *  it agrees, it has no purchase, or its purchases disagree among themselves (one mark can't fit
 *  both — resolveItcBlocked leaves such a note unmarked, and so does this). */
function disagreement(note: NoteRow, purchases: ReadonlySet<number>, marks: ReadonlyMap<number, boolean>): boolean | null {
  if (purchases.size === 0) return null
  const ms = new Set([...purchases].map((p) => marks.get(p) ?? false))
  if (ms.size !== 1) return null
  const m = [...ms][0]!
  return m !== (note.blocked === 1) ? m : null
}

const NOTE_COLS = `n.id, n.number, n.date, n.party_ledger_id AS party, n.reference AS ref, COALESCE(n.itc_blocked, 0) AS blocked`

/** The taxed debit notes that may return this purchase (its party's notes dated on or after it, and
 *  the notes linked to its lines), each with its purchases as the books stand now. */
export function candidateNotes(db: DB, purchaseId: number, parties: readonly (number | null)[]): Map<number, { note: NoteRow; purchases: Set<number> }> {
  const p = db.prepare('SELECT date FROM vouchers WHERE id = ?').get(purchaseId) as { date: string } | undefined
  if (!p) return new Map()
  const ps = [...new Set(parties.filter((x): x is number => x != null))]
  const rows = db
    .prepare(
      `SELECT ${NOTE_COLS} FROM vouchers n JOIN voucher_types nt ON nt.id = n.voucher_type_id
       WHERE ${TAXED_NOTE} AND n.date >= ?
         AND (n.id IN (SELECT to_voucher_id FROM line_links WHERE link_type = 'return' AND from_voucher_id = ?)
           ${ps.length ? `OR n.party_ledger_id IN (${ps.map(() => '?').join(',')})` : ''})
       ORDER BY n.date, n.id`
    )
    .all(p.date, purchaseId, ...ps) as NoteRow[]
  const purchases = notePurchases(db, rows)
  return new Map(rows.map((n) => [n.id, { note: n, purchases: purchases.get(n.id)! }]))
}

/**
 * The save warning: after a purchase's mark flipped, the notes that returned it (by the books before
 * OR after the save — a save that also changed its reference / bill name / party still names the
 * notes made against the old ones) whose mark now differs from all their purchases'. Mixed notes
 * (purchases of both marks) are left out: no single mark fits them.
 */
export function notesDisagreeingWithPurchase(
  db: DB,
  purchaseId: number,
  before: ReadonlyMap<number, { note: NoteRow; purchases: Set<number> }>,
  parties: readonly (number | null)[]
): string[] {
  const after = candidateNotes(db, purchaseId, parties)
  const ids = new Set<number>()
  for (const [id, c] of before) if (c.purchases.has(purchaseId)) ids.add(id)
  for (const [id, c] of after) if (c.purchases.has(purchaseId)) ids.add(id)
  if (ids.size === 0) return []
  const rows = [...ids].map((id) => after.get(id) ?? before.get(id)!).sort((a, b) => a.note.date.localeCompare(b.note.date) || a.note.id - b.note.id)
  const all = new Set<number>([purchaseId])
  for (const r of rows) for (const p of r.purchases) all.add(p)
  const marks = marksOf(db, [...all])
  const out: string[] = []
  for (const r of rows) {
    // Fresh state of the note (its own mark may not have changed, but read it as stored now).
    const purchases = new Set([...r.purchases, purchaseId])
    if (disagreement(r.note, purchases, marks) != null) out.push(`${r.note.number} of ${toDisplayDate(r.note.date)}`)
  }
  return out
}

/** gstValidate: the taxed debit notes dated in the period whose mark differs from that of every
 *  purchase they return (ids). A warning only — no figure is changed. */
export function mismatchedNoteIds(db: DB, from: string, to: string): number[] {
  const rows = db
    .prepare(
      `SELECT ${NOTE_COLS} FROM vouchers n JOIN voucher_types nt ON nt.id = n.voucher_type_id
       WHERE ${TAXED_NOTE} AND n.is_optional = 0 AND n.post_dated = 0 AND n.date BETWEEN ? AND ? ORDER BY n.date, n.id`
    )
    .all(from, to) as NoteRow[]
  if (rows.length === 0) return []
  const purchases = notePurchases(db, rows)
  const all = new Set<number>()
  for (const s of purchases.values()) for (const p of s) all.add(p)
  const marks = marksOf(db, [...all])
  return rows.filter((n) => disagreement(n, purchases.get(n.id)!, marks) != null).map((n) => n.id)
}
