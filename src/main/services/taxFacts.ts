/**
 * Tax-fact snapshots (to-do §4 GST, migration "tax-fact snapshots" — see migrations.ts).
 *
 * A GST document's rate, cess, HSN and the party's class (GSTIN, state, SEZ / export type, reverse
 * charge) used to be read from the masters at query time, so editing an item, a ledger or a party
 * rewrote old returns, e-documents and prints. saveVoucher copies those master facts onto the
 * voucher and its lines as it saves (`snapshotTaxFacts` — exactly what the readers would have read
 * from the masters at that moment), and the readers prefer the copy when the voucher carries one
 * (`snap_tax_facts = 1`) and read the masters, unchanged, when it does not. Nothing is backfilled:
 * a voucher saved before the migration keeps following the masters until it is saved again.
 *
 * Inside a snapshot a NULL fact means the master had none (a rate-less ledger — the posted-rate
 * rule still applies to it —, an item without HSN, a party without GSTIN). Imports that restore
 * history (Tally, books workbook, import / bulk-edit undo) store only the facts they carry
 * (`writeTaxFacts`; none = no snapshot), never today's masters.
 */
import type { DB } from '../db/connection'
import { partyGroupIdsBySide } from './masters'
import { noteFollowsBill, type PartyExportType } from '@shared/gst/zeroRated'

export interface LineTaxFacts {
  gstRate: number | null
  cessRate: number | null
  hsn: string | null
}

/** One voucher's snapshot: the party's class and one entry per ledger line / item line, in
 *  line order. */
export interface VoucherTaxFacts {
  /** `side` (WP 2d): a debit note's party side by its group's role; optional — absent / null = none
   *  recorded (the seeded Sundry Debtors rule, as before). */
  party: { gstin: string | null; state: string | null; exportType: string | null; rcm: number | null; side?: PartySide | null }
  lines: LineTaxFacts[]
  inventory: LineTaxFacts[]
}

export type PartySide = 'debtor' | 'creditor'

const schemaSeen = new WeakSet<DB>()
const sideSeen = new WeakMap<DB, boolean>()

/** WP 2d: the debit-note side column exists (a partly migrated test database has none). */
export function hasPartySideSnapshot(db: DB): boolean {
  let ok = sideSeen.get(db)
  if (ok === undefined) {
    ok = (db.prepare('PRAGMA table_info(vouchers)').all() as { name: string }[]).some((c) => c.name === 'snap_party_side')
    sideSeen.set(db, ok)
  }
  return ok
}

/** A debit note's party side now (by its group's role — `partyGroupIdsBySide`), else null. */
function debitNoteSide(db: DB, voucherId: number): PartySide | null {
  const v = db
    .prepare('SELECT vt.kind, p.group_id AS g FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id LEFT JOIN ledgers p ON p.id = v.party_ledger_id WHERE v.id = ?')
    .get(voucherId) as { kind: string; g: number | null } | undefined
  if (!v || v.kind !== 'debit_note' || v.g == null) return null
  if (partyGroupIdsBySide(db, 'debtor').has(v.g)) return 'debtor'
  if (partyGroupIdsBySide(db, 'creditor').has(v.g)) return 'creditor'
  return null
}

/** True once the snapshot columns exist (a partly migrated test database has none). */
export function hasTaxSnapshots(db: DB): boolean {
  if (schemaSeen.has(db)) return true
  const ok = (db.prepare('PRAGMA table_info(vouchers)').all() as { name: string }[]).some((c) => c.name === 'snap_tax_facts')
  if (ok) schemaSeen.add(db)
  return ok
}

/**
 * The SQL expression a reader selects for one fact: the voucher's copy when it carries a snapshot,
 * else the master column exactly as before. `v` is the vouchers alias of the query.
 */
export function snapOr(db: DB, v: string, snap: string, master: string): string {
  return hasTaxSnapshots(db) ? `(CASE WHEN ${v}.snap_tax_facts = 1 THEN ${snap} ELSE ${master} END)` : master
}

/** The party-class expressions for a query with vouchers `v` LEFT JOINed to the party ledger `p`. */
export function partySnapSql(db: DB, v = 'v', p = 'p'): { gstin: string; state: string; exportType: string; rcm: string } {
  return {
    gstin: snapOr(db, v, `${v}.snap_party_gstin`, `${p}.gstin`),
    state: snapOr(db, v, `${v}.snap_party_state`, `${p}.state_code`),
    exportType: snapOr(db, v, `${v}.snap_party_export_type`, `${p}.export_type`),
    rcm: snapOr(db, v, `COALESCE(${v}.snap_party_rcm, 0)`, `COALESCE(${p}.rcm, 0)`)
  }
}

/** The line-fact expressions for a line alias `line` (voucher_lines / inventory_lines) and its
 *  master alias `m` (ledgers / stock_items). */
export function lineSnapSql(db: DB, v: string, line: string, m: string): { gstRate: string; cessRate: string; hsn: string } {
  return {
    gstRate: snapOr(db, v, `${line}.snap_gst_rate`, `${m}.gst_rate`),
    cessRate: snapOr(db, v, `${line}.snap_cess_rate`, `${m}.cess_rate`),
    hsn: snapOr(db, v, `${line}.snap_hsn`, `${m}.hsn`)
  }
}

const SNAPSHOT_SQL = [
  `UPDATE voucher_lines SET
     snap_gst_rate = (SELECT l.gst_rate FROM ledgers l WHERE l.id = voucher_lines.ledger_id),
     snap_cess_rate = (SELECT l.cess_rate FROM ledgers l WHERE l.id = voucher_lines.ledger_id),
     snap_hsn = (SELECT l.hsn FROM ledgers l WHERE l.id = voucher_lines.ledger_id)
   WHERE voucher_id = ?`,
  `UPDATE inventory_lines SET
     snap_gst_rate = (SELECT s.gst_rate FROM stock_items s WHERE s.id = inventory_lines.stock_item_id),
     snap_cess_rate = (SELECT s.cess_rate FROM stock_items s WHERE s.id = inventory_lines.stock_item_id),
     snap_hsn = (SELECT s.hsn FROM stock_items s WHERE s.id = inventory_lines.stock_item_id)
   WHERE voucher_id = ?`,
  `UPDATE vouchers SET snap_tax_facts = 1,
     snap_party_gstin = (SELECT p.gstin FROM ledgers p WHERE p.id = vouchers.party_ledger_id),
     snap_party_state = (SELECT p.state_code FROM ledgers p WHERE p.id = vouchers.party_ledger_id),
     snap_party_export_type = (SELECT p.export_type FROM ledgers p WHERE p.id = vouchers.party_ledger_id),
     snap_party_rcm = (SELECT COALESCE(p.rcm, 0) FROM ledgers p WHERE p.id = vouchers.party_ledger_id)
   WHERE id = ?`
]
// Prepared once per connection (saveVoucher runs it on every save).
const snapshotStmts = new WeakMap<DB, { run(id: number): unknown }[]>()

/** Copy today's master facts onto a voucher just written by saveVoucher (inside its transaction). */
/** `recordSide` (WP 2d, review of #266): false keeps the voucher's stored debit-note side as it is —
 *  a note saved before WP 2d has none and keeps the old rule (no filed month moves on a re-save). */
export function snapshotTaxFacts(db: DB, voucherId: number, opts: { recordSide?: boolean; followBill?: boolean } = {}): void {
  if (!hasTaxSnapshots(db)) return
  let stmts = snapshotStmts.get(db)
  if (!stmts) {
    stmts = SNAPSHOT_SQL.map((sql) => db.prepare(sql))
    snapshotStmts.set(db, stmts)
  }
  for (const s of stmts) s.run(voucherId)
  if (opts.followBill !== false) followBillClass(db, voucherId)
  if (hasPartySideSnapshot(db) && opts.recordSide !== false) db.prepare('UPDATE vouchers SET snap_party_side = ? WHERE id = ?').run(debitNoteSide(db, voucherId), voucherId)
}

/**
 * Owner Q4 (audit 2 COR2-3): a credit note that took back GST its party's SEZ / export class would
 * not charge (shared/gst/zeroRated.ts noteFollowsBill — it follows a sale saved before the rule) is
 * snapshotted with the class its sales bills are READ with (each bill's own snapshot, else the live
 * master — as the GST readers take it), so GSTR-1 / 3B and the e-invoice report the note like its
 * bill and the two net to nil there too. Only when every such bill agrees; saveVoucher runs it on a
 * NEW note or one that already followed (review of #278) — an older note re-saved keeps its class.
 */
function followBillClass(db: DB, noteId: number): void {
  const n = db
    .prepare(
      `SELECT vt.kind, v.party_ledger_id AS party, v.reference AS ref, v.snap_party_export_type AS exportType FROM vouchers v
       JOIN voucher_types vt ON vt.id = v.voucher_type_id WHERE v.id = ?`
    )
    .get(noteId) as { kind: string; party: number | null; ref: string | null; exportType: PartyExportType | null } | undefined
  if (!n || n.kind !== 'credit_note' || n.party == null || !n.exportType) return
  if (noteFollowsBill('sales', n.exportType, postedHeads(db, noteId)) == null) return
  const ids = new Set<number>()
  for (const r of db
    .prepare(
      `SELECT DISTINCT ll.from_voucher_id AS id FROM line_links ll WHERE ll.to_voucher_id = ? AND ll.link_type = 'return' AND ll.from_voucher_id IS NOT NULL
       UNION SELECT b.voucher_id FROM bill_refs a JOIN bill_refs b ON b.kind = 'new' AND b.name = a.name AND b.party_ledger_id = a.party_ledger_id
         WHERE a.voucher_id = ? AND a.kind = 'against'
       UNION SELECT s.id FROM vouchers s WHERE s.party_ledger_id = ? AND s.number = ? AND s.id <> ? AND s.deleted_at IS NULL`
    )
    .all(noteId, noteId, n.party, n.ref ?? '', noteId) as { id: number }[]) ids.add(r.id)
  const classes = new Set<string | null>()
  const cls = db.prepare(
    `SELECT CASE WHEN COALESCE(v.snap_tax_facts, 0) = 1 THEN v.snap_party_export_type ELSE l.export_type END AS c
     FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id LEFT JOIN ledgers l ON l.id = v.party_ledger_id
     WHERE v.id = ? AND vt.kind = 'sales' AND v.deleted_at IS NULL`
  )
  for (const id of ids) {
    const r = cls.get(id) as { c: string | null } | undefined
    if (r) classes.add(r.c)
  }
  if (classes.size !== 1) return
  const c = [...classes][0]!
  if (c !== n.exportType) db.prepare('UPDATE vouchers SET snap_party_export_type = ? WHERE id = ?').run(c, noteId)
}

function postedHeads(db: DB, voucherId: number): { cgst: number; sgst: number; igst: number } {
  const out = { cgst: 0, sgst: 0, igst: 0 }
  for (const h of db
    .prepare(
      `SELECT l.tax_type AS t, SUM(CASE WHEN vl.dr_cr = 'dr' THEN vl.amount ELSE -vl.amount END) AS amt FROM voucher_lines vl
       JOIN ledgers l ON l.id = vl.ledger_id WHERE vl.voucher_id = ? AND l.tax_type IN ('cgst', 'sgst', 'igst') GROUP BY l.tax_type`
    )
    .all(voucherId) as { t: 'cgst' | 'sgst' | 'igst'; amt: number }[]) out[h.t] = h.amt
  return out
}

/** WP 2d: does this voucher already carry a recorded debit-note side (a note saved since WP 2d)? */
export function hasRecordedSide(db: DB, voucherId: number): boolean {
  if (!hasPartySideSnapshot(db)) return false
  return (db.prepare('SELECT snap_party_side IS NOT NULL AS s FROM vouchers WHERE id = ?').get(voucherId) as { s: number } | undefined)?.s === 1
}

type Stmt = { get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] }
const readStmts = new WeakMap<DB, { head: Stmt; lines: Stmt; inventory: Stmt }>()

/** The voucher's stored snapshot, or null when it carries none. */
export function readTaxFacts(db: DB, voucherId: number): VoucherTaxFacts | null {
  if (!hasTaxSnapshots(db)) return null
  let st = readStmts.get(db)
  if (!st) {
    const facts = (table: string): Stmt =>
      db.prepare(`SELECT snap_gst_rate AS gstRate, snap_cess_rate AS cessRate, snap_hsn AS hsn FROM ${table} WHERE voucher_id = ? ORDER BY line_order, id`)
    st = {
      head: db.prepare('SELECT snap_tax_facts AS on_, snap_party_gstin AS gstin, snap_party_state AS state, snap_party_export_type AS exportType, snap_party_rcm AS rcm FROM vouchers WHERE id = ?'),
      lines: facts('voucher_lines'),
      inventory: facts('inventory_lines')
    }
    readStmts.set(db, st)
  }
  const v = st.head.get(voucherId) as { on_: number | null; gstin: string | null; state: string | null; exportType: string | null; rcm: number | null } | undefined
  if (!v || v.on_ !== 1) return null
  const side = hasPartySideSnapshot(db) ? ((db.prepare('SELECT snap_party_side AS s FROM vouchers WHERE id = ?').get(voucherId) as { s: PartySide | null }).s) : null
  return {
    party: { gstin: v.gstin, state: v.state, exportType: v.exportType, rcm: v.rcm, ...(side ? { side } : {}) },
    lines: st.lines.all(voucherId) as LineTaxFacts[],
    inventory: st.inventory.all(voucherId) as LineTaxFacts[]
  }
}

/**
 * Store exactly the given snapshot (an import or an undo restoring history), or none (null). A
 * snapshot whose line counts no longer fit the voucher is not stored — facts are never attached
 * to the wrong line.
 */
export function writeTaxFacts(db: DB, voucherId: number, facts: VoucherTaxFacts | null): void {
  if (!hasTaxSnapshots(db)) return
  const ids = (table: string): number[] =>
    (db.prepare(`SELECT id FROM ${table} WHERE voucher_id = ? ORDER BY line_order, id`).all(voucherId) as { id: number }[]).map((r) => r.id)
  const lineIds = ids('voucher_lines')
  const invIds = ids('inventory_lines')
  const fits = !!facts && facts.lines.length === lineIds.length && facts.inventory.length === invIds.length
  const lineStmt = db.prepare('UPDATE voucher_lines SET snap_gst_rate = ?, snap_cess_rate = ?, snap_hsn = ? WHERE id = ?')
  const invStmt = db.prepare('UPDATE inventory_lines SET snap_gst_rate = ?, snap_cess_rate = ?, snap_hsn = ? WHERE id = ?')
  lineIds.forEach((id, i) => {
    const f = fits ? facts!.lines[i]! : null
    lineStmt.run(f?.gstRate ?? null, f?.cessRate ?? null, f?.hsn ?? null, id)
  })
  invIds.forEach((id, i) => {
    const f = fits ? facts!.inventory[i]! : null
    invStmt.run(f?.gstRate ?? null, f?.cessRate ?? null, f?.hsn ?? null, id)
  })
  const p = fits ? facts!.party : null
  db.prepare('UPDATE vouchers SET snap_tax_facts = ?, snap_party_gstin = ?, snap_party_state = ?, snap_party_export_type = ?, snap_party_rcm = ? WHERE id = ?')
    .run(fits ? 1 : null, p?.gstin ?? null, p?.state ?? null, p?.exportType ?? null, p?.rcm ?? null, voucherId)
  if (hasPartySideSnapshot(db)) db.prepare('UPDATE vouchers SET snap_party_side = ? WHERE id = ?').run(p?.side ?? null, voucherId)
}

/** A plain-object reading of a snapshot carried in an import / undo image (unknown shape → null). */
export function taxFactsFrom(value: unknown): VoucherTaxFacts | null {
  if (!value || typeof value !== 'object') return null
  const f = value as Partial<VoucherTaxFacts>
  if (!f.party || !Array.isArray(f.lines) || !Array.isArray(f.inventory)) return null
  const str = (x: unknown): string | null => (typeof x === 'string' ? x : null)
  const numOrNull = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const line = (l: unknown): LineTaxFacts => {
    const o = (l ?? {}) as Record<string, unknown>
    return { gstRate: numOrNull(o.gstRate), cessRate: numOrNull(o.cessRate), hsn: str(o.hsn) }
  }
  const side = f.party.side === 'debtor' || f.party.side === 'creditor' ? f.party.side : null
  return {
    party: { gstin: str(f.party.gstin), state: str(f.party.state), exportType: str(f.party.exportType), rcm: numOrNull(f.party.rcm), ...(side ? { side } : {}) },
    lines: f.lines.map(line),
    inventory: f.inventory.map(line)
  }
}

/**
 * What a re-save changed in a voucher's snapshot (review of #172): the party facts are not in the
 * editor's form, so saving an old bill after the customer moved state or changed GSTIN would move
 * its place of supply in GSTR-1 silently — saveVoucher reports these as a warning. Line facts are
 * compared per line only while the line count is unchanged (an edit that adds or removes lines
 * changed the bill itself). Plain sentences, one per changed fact.
 */
export function taxFactsDiff(before: VoucherTaxFacts, after: VoucherTaxFacts): string[] {
  const out: string[] = []
  const show = (x: string | number | null): string => (x === null || x === '' ? 'none' : String(x))
  const pct = (x: number | null): string => (x === null ? 'none' : `${x} %`)
  const p0 = before.party
  const p1 = after.party
  if (p0.gstin !== p1.gstin) out.push(`party GSTIN ${show(p0.gstin)} → ${show(p1.gstin)}`)
  if (p0.state !== p1.state) out.push(`party state ${show(p0.state)} → ${show(p1.state)}`)
  if (p0.exportType !== p1.exportType) out.push(`SEZ / export type ${show(p0.exportType)} → ${show(p1.exportType)}`)
  if ((p0.rcm ?? 0) !== (p1.rcm ?? 0)) out.push(`reverse charge ${p0.rcm ? 'on' : 'off'} → ${p1.rcm ? 'on' : 'off'}`)
  // WP 2d: a debit note's recorded side is not listed here — saveVoucher says when a save actually
  // moves the note between the outward notes and the purchase returns (review of #266).
  const lines = (label: string, a: LineTaxFacts[], b: LineTaxFacts[]): void => {
    if (a.length !== b.length) return
    a.forEach((l0, i) => {
      const l1 = b[i]!
      if (l0.gstRate !== l1.gstRate) out.push(`${label} ${i + 1} GST rate ${pct(l0.gstRate)} → ${pct(l1.gstRate)}`)
      if (l0.cessRate !== l1.cessRate) out.push(`${label} ${i + 1} cess ${pct(l0.cessRate)} → ${pct(l1.cessRate)}`)
      if (l0.hsn !== l1.hsn) out.push(`${label} ${i + 1} HSN ${show(l0.hsn)} → ${show(l1.hsn)}`)
    })
  }
  lines('item line', before.inventory, after.inventory)
  lines('account line', before.lines, after.lines)
  return out
}

/** The voucher kinds whose GST facts the returns, e-documents and prints read. */
export const TAX_FACT_KINDS: ReadonlySet<string> = new Set(['sales', 'purchase', 'credit_note', 'debit_note'])

/** A snapshotted voucher's party class (the columns of `partySnapSql`). */
export interface PartySnap { gstin: string | null; state: string | null; exportType: string | null; rcm: number }

/**
 * The party-class snapshots of the given vouchers (only those that carry one), read in chunks of
 * 500 — for the readers that scan a period, so their own query (and its covering indexes) stays
 * exactly as it was and the snapshot is applied per voucher afterwards (`withPartySnap`).
 */
export function partySnapshots(db: DB, voucherIds: readonly number[]): Map<number, PartySnap> {
  const out = new Map<number, PartySnap>()
  if (!hasTaxSnapshots(db) || voucherIds.length === 0) return out
  const ids = [...new Set(voucherIds)]
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = db
      .prepare(
        `SELECT id, snap_party_gstin AS gstin, snap_party_state AS state, snap_party_export_type AS exportType, COALESCE(snap_party_rcm, 0) AS rcm
         FROM vouchers WHERE id IN (${chunk.map(() => '?').join(',')}) AND snap_tax_facts = 1`
      )
      .all(...chunk) as (PartySnap & { id: number })[]
    for (const { id, ...s } of rows) out.set(id, s)
  }
  return out
}

/** A reader's row with its voucher's party snapshot applied (the row as read when there is none). */
export function withPartySnap<T extends { partyGstin?: string | null; partyState?: string | null; partyExportType?: string | null; partyRcm?: number }>(
  row: T, snap: PartySnap | undefined
): T {
  if (!snap) return row
  const out = { ...row }
  if ('partyGstin' in row) out.partyGstin = snap.gstin
  if ('partyState' in row) out.partyState = snap.state
  if ('partyExportType' in row) out.partyExportType = snap.exportType as T['partyExportType']
  if ('partyRcm' in row) out.partyRcm = snap.rcm
  return out
}
